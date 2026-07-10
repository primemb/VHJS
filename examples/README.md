# VHJS Examples

This folder has two jobs:

1. **Local dev sandbox** — while building VHJS, run these scripts against the
   library source (via a workspace link, not the published package) to exercise
   real behavior on real video files.
2. **Usage docs** — once the API stabilizes, these double as copy-paste examples
   showing people how to use VHJS.

> Examples import VHJS from the workspace (e.g. `import { transcodeToHls } from 'vhjs'`
> resolved via the pnpm workspace / path alias), so changes to `src/` are picked
> up immediately. They are **not** shipped in the published npm package.

## Layout (as features land)

```
examples/
  README.md
  assets/                  # small sample inputs (short, low-res clips) + .gitignore for large files
  01-probe.ts              # probe a file, print SourceMetadata
  02-basic-hls.ts          # transcode one input to a single HLS rendition
  03-abr-ladder.ts         # full adaptive-bitrate ladder (1080/720/480) + master playlist
  04-extract-audio.ts      # "spread" / demux audio out of a video
  05-add-audio-track.ts    # add an alternate-language audio track to an existing HLS package
  06-add-subtitles.ts      # add WebVTT subtitles to an existing HLS package
  07-progress-events.ts    # subscribe to progress + cancel via AbortSignal
  08-dry-run.ts            # print the FFmpeg argv without executing
  09-playlist-manipulation.ts # parse/inspect/serialize media playlist metadata
  frameworks/
    README.md              # setup, security, and integration notes
    express/               # REST API + SSE progress + static HLS server
    fastify/               # Fastify REST API + static HLS server
    nestjs/                # NestJS provider/controller + static HLS server
    nextjs/                # App Router route handlers + SSE + public HLS files
```

## Running an example (local dev)

```bash
pnpm install                      # from repo root; links the workspace
ffmpeg -version                   # examples need FFmpeg + ffprobe
pnpm example 01-probe             # probe the bundled clip, print SourceMetadata
pnpm example 02-basic-hls         # single 720p rendition
pnpm example 03-abr-ladder        # auto ABR ladder + live progress
pnpm example 07-progress-events   # EventEmitter + AsyncIterable progress
pnpm example 08-dry-run           # print the ffmpeg argv without running it
pnpm example 09-playlist-manipulation # parse and reserialize a media playlist (no FFmpeg needed)
pnpm example 04-extract-audio     # demux audio to a file (copy + aac modes)
pnpm example 05-add-audio-track   # add an alternate-audio track to a package
pnpm example 06-add-subtitles     # add WebVTT/SRT subtitles to a package
```

> The audio examples (`04`/`05`) need an input **with an audio track**. The
> default `1min.mp4` is audio-less, so they use `audioSampleInput()` (defaults to
> `mobile.mkv`); point it elsewhere with `VHJS_SAMPLE_AUDIO=/path/to/clip.mp4`.

If FFmpeg is not on your `PATH`, point the examples at the binaries explicitly:

```bash
VHJS_FFMPEG_PATH=/path/to/ffmpeg VHJS_FFPROBE_PATH=/path/to/ffprobe \
  pnpm example 03-abr-ladder
```

Generated HLS lands under `examples/.out/<name>/` (gitignored).

## Framework recipes

The framework integrations live in [`frameworks/`](./frameworks/README.md). They
are deliberately **copy-into-your-app recipes**, not VHJS dependencies: install
only the framework you use in that application. The Express and Next.js recipes
also expose a Server-Sent Events (SSE) endpoint backed by `TranscodeJob` progress;
all recipes serve completed HLS packages from a dedicated output root.

## Two ways to call the API

```ts
import { createVhjs, probe, transcodeToHls } from "vhjs";

// Preferred: configure once (binaries resolved a single time), reuse the instance.
const vhjs = createVhjs({ ffmpegPath: "/opt/ffmpeg" });
await vhjs.probe("in.mp4");
await vhjs.transcodeToHls({ input: "in.mp4", outputDir: "out" });

// One-shot convenience (options per call) — fine for a single call.
await probe("in.mp4", { ffmpegPath: "/opt/ffmpeg" });
await transcodeToHls({ input: "in.mp4", outputDir: "out" });
```

## Fluent jobs and streaming progress

```ts
import { createVhjs, vhjs } from "vhjs";

// Optional fluent builder. With no `.rendition()`, VHJS auto-derives the ladder.
await vhjs("in.mp4").output("out").run();

// A started job provides both standard Node events and async iteration.
const client = createVhjs();
const job = client.startTranscodeToHls({ input: "in.mp4", outputDir: "out" });
job.on("progress", (event) => console.log(event.percent));
for await (const event of job) console.log(event.speed);
await job.result;
```

## Custom ffmpeg options

Pass additive flags via `inputArgs` (before `-i`) and `outputArgs` (before the
HLS muxer). VHJS rejects anything that collides with the flags it manages
(mapping, codecs, rate control, `-preset`, the HLS muxer) with a typed
`ConflictingFfmpegArgError`:

```ts
await vhjs.transcodeToHls({
  input: "in.mp4",
  outputDir: "out",
  inputArgs: ["-hwaccel", "cuda"],        // global/input options
  outputArgs: ["-tune", "film", "-crf", "20"], // per-output options
});
```

## Rules for example code

- Examples must stay **runnable and current** — if an example breaks after an API
  change, the change isn't done. (A smoke check runs them in CI where feasible.)
- Keep sample assets **tiny** (a few seconds, low resolution). Do not commit large
  media; `assets/.gitignore` ignores everything except small tracked fixtures.
- Examples show the **happy path clearly**, then note error handling — including
  catching typed errors like `ResolutionUpscaleError` / `BitrateExceedsSourceError`.
- Examples are documentation: favor clarity over cleverness; comment the *why*.
