# VHJS

**VHJS** is a TypeScript-first, framework-agnostic Node.js library for turning
video into adaptive-bitrate HLS with FFmpeg. It probes first, validates the job
before FFmpeg starts, and exposes typed results, warnings, errors, and progress.

## Requirements

- Node.js 22 or newer.
- `ffmpeg` and `ffprobe` on `PATH`, or explicit binary paths supplied to VHJS.

VHJS does not bundle FFmpeg. Confirm your installation with `ffmpeg -version`
and `ffprobe -version`.

## Install

```bash
pnpm add @primemb/vhjs
```

## Quickstart

Create one client and reuse it. Binary paths are resolved and verified on the
first operation, then shared by the client.

```ts
import { asBitrate, asPixels, createVhjs, type Rendition } from "@primemb/vhjs";

const video = createVhjs();
const rendition = (height: number, video: number, audio: number): Rendition => ({
  height: asPixels(height),
  videoBitrate: asBitrate(video),
  audioBitrate: asBitrate(audio),
  videoCodec: "h264",
  audioCodec: "aac",
});

const result = await video.transcodeToHls({
  input: "input.mp4",
  outputDir: "public/hls",
  ladder: {
    mode: "explicit",
    renditions: [
      rendition(1080, 5_000_000, 128_000),
      rendition(720, 2_800_000, 128_000),
      rendition(480, 1_400_000, 96_000),
    ],
  },
});

console.log(result.masterPlaylistPath); // public/hls/master.m3u8
```

Omit `ladder` (or use `{ mode: "auto" }`) to derive a sensible ladder from the
source. Source dimensions, orientation, and bitrates are considered before the
command runs; VHJS never knowingly upscales a requested rendition.

## Core API

| Export | Purpose |
| --- | --- |
| `createVhjs(options?)` | Creates a reusable `Vhjs` client. Use this for applications and workers. |
| `probe(input, options?)` | One-shot source probe returning `SourceMetadata`. |
| `transcodeToHls(request, options?)` | One-shot HLS transcode; returns `TranscodeResult` or `DryRunResult`. |
| `startTranscodeToHls(request, options?)` | Starts an HLS job with EventEmitter and AsyncIterable progress. |
| `vhjs(input, options?)` | Begins the immutable fluent HLS-job builder. |
| `extractAudio(request, options?)` | Extracts one source audio stream as a bitstream copy or AAC. |
| `addAudioTrack(request, options?)` | Adds an alternate audio rendition to an existing HLS package. |
| `addSubtitleTrack(request, options?)` | Adds a WebVTT or SRT subtitle rendition to an existing HLS package. |
| `removeAudioTrack(request, options?)` | Soft- or hard-removes an alternate audio rendition. |
| `removeSubtitleTrack(request, options?)` | Soft- or hard-removes an alternate subtitle rendition. |
| `generateThumbnail(request, options?)` | Generates one JPEG frame after validating its timestamp. |

`VhjsOptions` accepts `ffmpegPath`, `ffprobePath`, and an optional structured
`logger`. Every one-shot operation accepts the same options as its second
argument.

### HLS jobs

`HlsJobConfig` takes `input`, `outputDir`, and either an automatic or explicit
ladder. Common optional fields are `segmentDuration`, `masterPlaylistName`,
`preset`, `frameRate`, `bitratePolicy`, `inputArgs`, `outputArgs`, `signal`,
`onProgress`, and `dryRun`.

```ts
import { asFrameRate, createVhjs } from "@primemb/vhjs";

const video = createVhjs({ ffmpegPath: "/opt/ffmpeg" });
await video.transcodeToHls({
  input: "input.mov",
  outputDir: "hls",
  preset: "fast",
  frameRate: asFrameRate(24),
  ladder: { mode: "auto" },
  inputArgs: ["-hwaccel", "cuda"],
  outputArgs: ["-crf", "20"],
});
```

`inputArgs` and `outputArgs` are additive only. VHJS rejects arguments that
conflict with flags it manages, such as mappings, codecs, rate control, preset,
and HLS muxer settings.

### Progress and cancellation

`startTranscodeToHls` returns a `TranscodeJob`. It emits `progress` events and
is also an `AsyncIterable<ProgressEvent>`; await `job.result` for completion.
Pass an `AbortSignal` in any HLS/audio/subtitle/thumbnail request to cancel it.

```ts
const controller = new AbortController();
const job = video.startTranscodeToHls({
  input: "input.mp4",
  outputDir: "hls",
  signal: controller.signal,
});

for await (const event of job) {
  console.log(event.percent, event.speed);
}
await job.result;
```

### Audio, subtitles, and thumbnails

Audio extraction requires an explicit `mode`: `"copy"` preserves the source
bitstream, while `"aac"` re-encodes and downmixes to stereo by default.
Alternate tracks patch an existing master playlist while preserving its variants.
For audio, reuse `groupId` to add multiple languages. Subtitle input may be
WebVTT or SRT; SRT is converted to WebVTT during packaging.

```ts
await video.addSubtitleTrack({
  packageDir: "hls",
  subtitleInput: "captions.en.srt",
  language: "en",
  name: "English",
  groupId: "subtitles",
});

await video.generateThumbnail({
  input: "input.mp4",
  output: "public/poster.jpg",
  timestampSeconds: 3,
});
```

Track removal uses `mode: "soft"` to patch only the master playlist, or
`mode: "hard"` to also remove VHJS-generated rendition files. Hard removal
rejects unsafe playlist URIs that would escape the HLS package directory.

### Dry runs

Set `dryRun: true` on a transcode, audio, subtitle, or thumbnail request to
receive the exact FFmpeg argv without creating directories, writing files, or
running FFmpeg. Use the corresponding `isDryRun`, `isAudioDryRun`,
`isSubtitleDryRun`, or `isThumbnailDryRun` guard to narrow the result.

## Public types and helpers

| Group | Exports |
| --- | --- |
| Job configuration | `HlsJobConfig`, `HlsJobOptions`, `HlsLadderConfig`, `BitratePolicy`, `TranscodeRequest`, `FfmpegPreset`, `FFMPEG_PRESETS` |
| Results and media | `SourceMetadata`, `Rendition`, `TranscodeResult`, `ProgressEvent`, `ValidationWarning`, audio/subtitle/thumbnail/track request and result types |
| Validated scalars | `asBitrate`, `asFrameRate`, `asMilliseconds`, `asPixels` and their branded types |
| HLS helpers | `autoLadder`, `normalizeLadder`, `buildHlsCommand`, playlist parse/serialize/patch helpers, and audio/subtitle/thumbnail command builders |
| Guards | `isDryRun`, `isAudioDryRun`, `isSubtitleDryRun`, `isThumbnailDryRun`, `isFfmpegPreset` |

The complete generated API reference is produced with `pnpm docs` in
`docs/api/`. The public package entry is ESM-only; use normal ESM imports.

## Errors

All library errors extend `VhjsError` and have a discriminating `code` suitable
for `switch` statements. Important error exports include
`ResolutionUpscaleError`, `BitrateExceedsSourceError`, `ProbeError`,
`TranscodeError`, `PlaylistParseError`, `NoAudioTrackError`,
`NoSubtitleTrackError`, `InvalidThumbnailTimestampError`,
`ThumbnailTimestampExceedsDurationError`, `UnsafePlaylistUriError`, and binary
resolution errors.

## Examples and framework recipes

The runnable examples cover probing, basic HLS, ABR, audio extraction,
alternate audio, subtitles, progress streaming, dry runs, playlist manipulation,
and thumbnails. Run them from a clone of this repository:

```bash
pnpm install
pnpm example 01-probe
pnpm example 08-dry-run
```

See [examples/README.md](examples/README.md) for the full list, media setup, and
framework recipes for Express, Fastify, NestJS, and Next.js.

## Development and releases

```bash
pnpm build       # ESM bundle and declarations
pnpm typecheck
pnpm lint
pnpm test:cov
pnpm test:e2e    # requires FFmpeg
pnpm docs        # generated reference in docs/api/
```

Releases follow Semantic Versioning. See [CHANGELOG.md](CHANGELOG.md) for
published changes and upgrade notes.

### Automated npm publishing

After the initial manual publication, npm trusted publishing releases a new
version automatically when a version-changing commit reaches `main`; the full
cross-platform check and FFmpeg E2E job must pass first. Configure npm's trusted
publisher for GitHub repository `primemb/VHJS`, workflow file `ci.yml`, and the
`npm publish` permission. No npm token is stored in GitHub.

## License

[MIT](LICENSE)
