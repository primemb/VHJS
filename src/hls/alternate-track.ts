/**
 * Alternate-track removal use case. The master-playlist transformation lives in
 * `playlist.ts`; this module performs the deliberately small I/O half over the
 * injected filesystem port. A hard removal is restricted to the rendition's
 * own relative directory so a malicious or malformed URI cannot escape the HLS
 * package.
 */
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileSystem } from "../ports/index.js";
import type {
  AlternateTrackRemovalMode,
  RemoveAlternateTrackRequest,
  RemoveAlternateTrackResult,
} from "../types/tracks.js";
import {
  AlternateTrackNotFoundError,
  ProbeError,
  UnsafePlaylistUriError,
} from "../validation/errors.js";
import {
  parseMasterPlaylist,
  removeAlternateRendition,
  serializeMasterPlaylist,
} from "./playlist.js";

const DEFAULT_MASTER_NAME = "master.m3u8";

/** Dependencies for alternate-track removal. */
export interface AlternateTrackToolsDeps {
  readonly fs: FileSystem;
}

/** Alternate-track removal use case bound to the filesystem adapter. */
export interface AlternateTrackTools {
  removeAlternateTrack(
    kind: "AUDIO" | "SUBTITLES",
    request: RemoveAlternateTrackRequest,
  ): Promise<RemoveAlternateTrackResult>;
}

/** Return the safe package-relative rendition directory for a playlist URI. */
export function renditionDirectory(packageDir: string, uri: string): string {
  if (
    uri.length === 0 ||
    isAbsolute(uri) ||
    uri.includes("\\") ||
    uri.includes("?") ||
    uri.includes("#")
  ) {
    throw new UnsafePlaylistUriError(uri);
  }
  const relativeDirectory = dirname(uri);
  if (relativeDirectory === "." || relativeDirectory === "..") {
    throw new UnsafePlaylistUriError(uri);
  }
  const packageRoot = resolve(packageDir);
  const target = resolve(packageRoot, relativeDirectory);
  const pathFromPackage = relative(packageRoot, target);
  if (
    pathFromPackage === "" ||
    pathFromPackage === ".." ||
    pathFromPackage.startsWith(`..${sep}`)
  ) {
    throw new UnsafePlaylistUriError(uri);
  }
  return `${packageDir.replace(/\\/g, "/").replace(/\/+$/, "")}/${relativeDirectory}`;
}

/** Create alternate-track removal tools over the injected filesystem port. */
export function createAlternateTrackTools(deps: AlternateTrackToolsDeps): AlternateTrackTools {
  return {
    async removeAlternateTrack(
      kind: "AUDIO" | "SUBTITLES",
      request: RemoveAlternateTrackRequest,
    ): Promise<RemoveAlternateTrackResult> {
      const masterName = request.masterPlaylistName ?? DEFAULT_MASTER_NAME;
      const masterPath = join(request.packageDir, masterName);
      if (!(await deps.fs.exists(masterPath))) {
        throw new ProbeError(`Master playlist not found: ${masterPath}`);
      }
      const parsed = parseMasterPlaylist(await deps.fs.readFile(masterPath));
      const removal = removeAlternateRendition(parsed, kind, request.groupId, request.name);
      if (removal.removed === null) {
        throw new AlternateTrackNotFoundError(kind, request.groupId, request.name);
      }
      const mode: AlternateTrackRemovalMode = request.mode ?? "soft";
      await deps.fs.writeFile(masterPath, serializeMasterPlaylist(removal.playlist));
      if (mode === "hard") {
        await deps.fs.removeDir(renditionDirectory(request.packageDir, removal.removed.uri));
      }
      return {
        masterPlaylistPath: masterPath,
        kind,
        groupId: request.groupId,
        name: request.name,
        mode,
        removedUri: removal.removed.uri,
      };
    },
  };
}
