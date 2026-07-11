/** Public request/result types for removing alternate HLS audio and subtitle tracks. */

/** Whether a removal preserves generated rendition files or deletes them too. */
export type AlternateTrackRemovalMode = "soft" | "hard";

/** Shared selector for one `EXT-X-MEDIA` alternate rendition. */
export interface RemoveAlternateTrackRequest {
  /** Directory of the HLS package that owns the master playlist. */
  readonly packageDir: string;
  /** Master playlist filename within `packageDir` (default `master.m3u8`). */
  readonly masterPlaylistName?: string;
  /** `GROUP-ID` of the alternate rendition. */
  readonly groupId: string;
  /** `NAME` of the alternate rendition within its group. */
  readonly name: string;
  /** `soft` only patches the master; `hard` also deletes generated rendition files. */
  readonly mode?: AlternateTrackRemovalMode;
}

/** Result of removing an alternate rendition from an HLS package. */
export interface RemoveAlternateTrackResult {
  readonly masterPlaylistPath: string;
  readonly kind: "AUDIO" | "SUBTITLES";
  readonly groupId: string;
  readonly name: string;
  readonly mode: AlternateTrackRemovalMode;
  /** The playlist URI formerly referenced by the removed rendition. */
  readonly removedUri: string;
}

/** Request to remove an alternate-audio rendition. */
export type RemoveAudioTrackRequest = RemoveAlternateTrackRequest;

/** Request to remove an alternate subtitle rendition. */
export type RemoveSubtitleTrackRequest = RemoveAlternateTrackRequest;
