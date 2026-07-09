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
  frameworks/
    express/               # minimal Express endpoint that transcodes an upload
    fastify/               # Fastify equivalent
    nestjs/                # NestJS provider/controller
    nextjs/                # Next.js route handler + SSE progress to the browser
```

## Running an example (local dev)

```bash
pnpm install                      # from repo root; links the workspace
ffmpeg -version                   # examples need FFmpeg on PATH
pnpm example 03-abr-ladder        # planned script: runs examples/03-abr-ladder.ts via tsx
```

## Rules for example code

- Examples must stay **runnable and current** — if an example breaks after an API
  change, the change isn't done. (A smoke check runs them in CI where feasible.)
- Keep sample assets **tiny** (a few seconds, low resolution). Do not commit large
  media; `assets/.gitignore` ignores everything except small tracked fixtures.
- Examples show the **happy path clearly**, then note error handling — including
  catching typed errors like `ResolutionUpscaleError` / `BitrateExceedsSourceError`.
- Examples are documentation: favor clarity over cleverness; comment the *why*.
