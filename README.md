# VHJS

> **Video-HLS-JS** — a TypeScript-first, framework-agnostic Node.js library that
> turns any video into **adaptive-bitrate HLS** on top of FFmpeg. Probe-first,
> fail-typed, streaming-friendly.

> ⚠️ **Status: early development (0.1.0).** The pipeline is being built phase by
> phase — see [`TODO.md`](TODO.md). APIs may change until 1.0.

## What it does

- **Transcode to HLS** — generate an ABR ladder (multiple resolution/bitrate
  renditions) with a master `.m3u8`.
- **Extract / "spread" audio** from a video into its own rendition or file.
- **Add alternate audio tracks** (extra languages, commentary) to an existing
  HLS package as `EXT-X-MEDIA` renditions.
- **Add WebVTT subtitles** to an existing HLS package.
- **Control encoding** — resolution, video/audio bitrate, codec, segment length.
- **Validate against the source** — a rendition that upscales resolution or
  exceeds the source bitrate is rejected with a **typed error** before FFmpeg
  runs.

## Requirements

- Node.js `>= 22` (developed on `26.5.0`, see [`.nvmrc`](.nvmrc)).
- **FFmpeg + ffprobe** on your `PATH` (or configured via an explicit override).
  VHJS shells out to them — it does not bundle libav. Verify with
  `ffmpeg -version` and `ffprobe -version`.

## Install

```bash
pnpm add vhjs   # not yet published — coming with 0.1.0
```

## Quickstart

> The public API is landing in Phases 3–4 (see `TODO.md`). This is the intended
> shape:

```ts
import { transcodeToHls } from "vhjs";

const result = await transcodeToHls({
  input: "input.mp4",
  outDir: "out/",
  // ladder is validated & clamped against the source before FFmpeg runs
  renditions: [
    { height: 1080, videoBitrate: "5000k", audioBitrate: "128k" },
    { height: 720, videoBitrate: "2800k", audioBitrate: "128k" },
    { height: 480, videoBitrate: "1400k", audioBitrate: "96k" },
  ],
});

console.log(result.masterPlaylist); // out/master.m3u8
```

## Development

```bash
pnpm install       # install deps
pnpm build         # bundle to dist/ (esm + .d.ts) via tsup
pnpm test          # unit tests (vitest)
pnpm test:cov      # tests + coverage gate (>=90% line & branch)
pnpm lint          # lint + format check (biome)
pnpm typecheck     # tsc --noEmit
pnpm example <name>  # run an examples/ script against the source (tsx)
```

See [`CLAUDE.md`](CLAUDE.md) for architecture and contribution conventions, and
[`examples/`](examples/README.md) for a live local dev sandbox + usage recipes.

## License

[MIT](LICENSE)
