/**
 * Filesystem adapter — implements the `FileSystem` port over `node:fs/promises`.
 * The only place (besides sibling `core/` modules) allowed to touch `node:fs`.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import type { FileSystem } from "../ports/index.js";

/** Create a `FileSystem` backed by the real Node filesystem. */
export function createNodeFileSystem(): FileSystem {
  return {
    async exists(path: string): Promise<boolean> {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },

    async mkdirp(path: string): Promise<void> {
      await mkdir(path, { recursive: true });
    },

    async writeFile(path: string, data: string): Promise<void> {
      await writeFile(path, data, "utf8");
    },

    async readFile(path: string): Promise<string> {
      return readFile(path, "utf8");
    },

    async readDir(path: string): Promise<string[]> {
      return readdir(path);
    },
  };
}
