# CLAUDE.md — VHJS

> **VHJS** (*Video-HLS-JS*) is a TypeScript-first Node.js library that turns any
> video into **adaptive-bitrate HLS** on top of FFmpeg — with a friendly,
> framework-agnostic API and aggressive type-safety.

This file orients Claude Code (and humans) working in this repo. Keep it short,
accurate, and current. If you change architecture, update this file in the same PR.

---

## What this library does

Given an input video, VHJS produces a complete HLS package (master playlist +
per-rendition media playlists + segments) and lets the user:

1. **Transcode to HLS** — generate an ABR ladder (multiple resolution/bitrate
   renditions) with a master `.m3u8`.
2. **Extract / demux audio** from a video (the "spread audio" idea) into its own
   audio rendition or a standalone file.
3. **Add extra audio tracks** (e.g. extra languages, commentary) to an
   *existing* HLS package as `EXT-X-MEDIA` alternate audio renditions.
4. **Add subtitles** (WebVTT) to an existing HLS package as `EXT-X-MEDIA`
   subtitle renditions.
5. **Remove alternate audio or subtitle tracks** softly (master-reference only)
   or hard (also delete their generated rendition directory).
6. **Generate thumbnails** at a validated source timestamp (second `1` by default).
7. **Control encoding parameters** — output resolution, video bitrate, audio
   bitrate, target FPS, libx264 preset, codec, segment duration, etc.
8. **Validate against the source**: a requested rendition that *upscales*
   resolution or *exceeds* the source bitrate is rejected with a **typed error**
   before FFmpeg ever runs (probe-first, fail-fast).

**Design non-negotiables**

- **Framework-agnostic core.** No coupling to Express/Fastify/NestJS/Next. The
  core is plain async functions + events; framework adapters (if any) live in
  separate, optional entry points.
- **Type-safety first.** Public API is fully typed; invalid combinations should
  be unrepresentable or caught at validation time with discriminated-union errors.
- **Fail fast, fail typed.** Probe the source, validate the request, then run.
  Never surface a raw FFmpeg stderr blob as the primary error.
- **Streaming-friendly.** Long jobs emit progress; jobs are cancelable via
  `AbortSignal`.
- **Every function is unit-tested.** No function ships without a test. Business
  logic must be testable **without spawning FFmpeg** (see Testing below).
- **Clean Code + SOLID + Clean Architecture.** Small, single-purpose functions;
  dependencies point inward; FFmpeg/FS/child-process are pluggable adapters, not
  hard-wired into the domain (see Clean Architecture below).

---

## Tech stack & environment

- **Runtime:** Node.js `26.5.0` (see `.nvmrc`). ESM only (`"type": "module"`).
- **Package manager:** `pnpm` (`^11.10.0`, pinned in `package.json` devEngines).
- **Language:** TypeScript, `strict` + `noUncheckedIndexedAccess` (target NodeNext).
- **External dep:** FFmpeg + ffprobe binaries (spawned as child processes — VHJS
  does **not** bundle libav; it shells out). **Resolved from system `PATH`, with
  an explicit user override** — no bundled static binary.

**Locked defaults**

- **Binaries:** system `PATH` + override (not bundled).
- **Default codecs (MVP):** **H.264 + AAC** for maximum HLS compatibility;
  other codecs are opt-in later.
- **Bitrate policy:** **clamp + warn** when a requested bitrate is at/near the
  source; hard `BitrateExceedsSourceError` only when *clearly above* source.

**Dev tooling (confirmed & installed):** `tsdown` for builds (Rolldown/oxc —
chosen over `tsup`), `vitest` + `@vitest/coverage-v8` for tests + coverage gate,
`biome` for lint/format, `typedoc` for API docs, `tsx` to run `examples/`.

---

## Commands

> Phase 0 toolchain is in place. `pnpm test:e2e` lands with Phase 3 (needs FFmpeg).

```bash
pnpm install          # install deps (approves esbuild build; see pnpm-workspace.yaml)
pnpm build            # bundle to dist/ (esm .mjs + .d.mts)   [tsdown]
pnpm test             # run unit tests                        [vitest]
pnpm test:cov         # unit tests + coverage gate (≥90%)     [vitest]
pnpm lint             # lint + format check                   [biome]
pnpm lint:fix         # apply safe lint/format fixes          [biome]
pnpm typecheck        # tsc --noEmit
pnpm docs             # generate API docs to docs/api         [typedoc]
pnpm example <name>   # run an examples/ script vs the source [tsx]
pnpm test:e2e         # transcode fixture videos end-to-end   [planned: Phase 3]
```

**Local dev loop:** build a feature, then exercise it against real media in
`examples/` (`pnpm example <name>`). Examples resolve VHJS from the workspace
source, so they're the fastest way to see a change actually work end-to-end.
They also become the published usage docs — keep them runnable. See
[`examples/README.md`](examples/README.md).

FFmpeg must be on `PATH` (or configured) to run e2e tests. Verify with
`ffmpeg -version` and `ffprobe -version`.

---

## Architecture (target layout)

The core is a pipeline: **resolve binaries → probe source → validate request →
build FFmpeg command → run & stream progress → write/patch playlists.**

```
src/
  index.ts               # public API surface (single entry, re-exports)
  core/
    binaries.ts          # resolve/validate ffmpeg & ffprobe paths (override-able)
    ffprobe.ts           # probe input -> SourceMetadata (streams, codecs, res, bitrate, duration)
    ffmpeg.ts            # spawn ffmpeg, build args, capture/parse stderr
    progress.ts          # parse ffmpeg progress -> typed events (percent, fps, time, speed)
    process.ts           # child-process lifecycle, AbortSignal, cancellation
  hls/
    transcoder.ts        # orchestrates a full HLS transcode job
    ladder.ts            # build/normalize the ABR rendition ladder
    playlist.ts          # parse & generate m3u8 (master + media playlists)
    audio.ts             # extract audio; add alternate audio renditions to existing HLS
    subtitle.ts          # segment WebVTT; add subtitle renditions to existing HLS
    alternate-track.ts   # remove alternate renditions (soft/hard) safely
    thumbnail.ts         # probe-validated single-frame thumbnail generation
  validation/
    rules.ts             # resolution/bitrate/codec checks vs SourceMetadata
    errors.ts            # typed error classes (see below)
  ports/
    index.ts             # port interfaces: FfmpegRunner, ProbeService, FileSystem, Clock, Logger
  builder/
    job-builder.ts       # optional fluent builder over the config object (composition root)
  types/
    config.ts            # public config types (discriminated unions)
    metadata.ts          # SourceMetadata & rendition types
    brands.ts            # branded types (Resolution, Bitrate, ...)
  utils/

tests/                   # (or co-located *.test.ts) — mirrors src/; fakes for all ports
  fixtures/              # recorded ffprobe JSON, ffmpeg stderr samples, tiny e2e clips

examples/                # local dev sandbox + usage docs (NOT published); see examples/README.md
  assets/                # tiny sample clips (large media git-ignored)
  frameworks/            # Express / Fastify / NestJS / Next.js recipes
```

> `core/` (adapters) is the **only** layer allowed to import `node:child_process`
> / `node:fs`. Inner layers (`hls/`, `validation/`, `types/`) import from
> `ports/`, never from `core/`.

```text
Dependency direction:  types ← validation ← hls (use cases) ← builder/index (composition)
                                                  │
                                             ports (interfaces)  ←  core (adapters)
```

### Key public types (intended shape)

- `SourceMetadata` — everything ffprobe tells us (video/audio/subtitle streams,
  width/height, bitrate, codec, fps, duration, channels).
- `HlsJobConfig` — input, output dir, rendition ladder, segment/HLS options.
- `Rendition` — `{ height, videoBitrate, audioBitrate, codec? }`.
- `TranscodeResult` — master playlist path, per-rendition outputs, timings.
- Progress event — `{ percent, timeMs, fps, speed, currentRendition }`.

### Typed errors (validation contract)

All thrown from `validation/errors.ts`, extending a base `VhjsError` with a
discriminant `code` for `switch`-based handling:

- `ResolutionUpscaleError` — requested height > source height.
- `BitrateExceedsSourceError` — requested video/audio bitrate > source.
- `UnsupportedCodecError` — source or requested codec not handled.
- `FfmpegNotFoundError` / `FfprobeNotFoundError` — binary missing/unusable.
- `ProbeError` — ffprobe failed or returned unparseable data.
- `TranscodeError` — ffmpeg exited non-zero (wraps exit code + tail of stderr).
- `PlaylistParseError` — malformed m3u8 when patching an existing package.

---

## Conventions

- **ESM + NodeNext.** Use `.js` extensions in relative import specifiers.
- **No `any` in public API.** Prefer discriminated unions and branded types;
  make illegal states unrepresentable.
- **Errors are typed and thrown** (not returned as strings). Every thrown error
  is a `VhjsError` subclass with a `code`.
- **Core stays pure of frameworks.** Anything HTTP/framework-specific is opt-in
  and isolated.
- **Cross-platform.** Runs on Windows/macOS/Linux — never assume POSIX paths;
  use `node:path`. Don't hardcode FFmpeg flags that only exist on one platform.
- **Side-effect discipline.** Filesystem writes go only under the user's chosen
  output dir; never write outside it.
- **Every FFmpeg invocation must be inspectable** (`dryRun` returns the argv).

---

## Clean Architecture & SOLID (mandatory)

Dependencies point **inward**. The domain knows nothing about FFmpeg, the
filesystem, or child processes — those are injected as interfaces (ports) and
implemented by adapters at the edge. This is what makes every function unit-
testable without touching real binaries.

**Layers (inner → outer):**

1. **Domain** (`types/`, `validation/`, `hls/ladder.ts`, `hls/playlist.ts`) —
   pure logic and types. No I/O, no `node:child_process`, no `node:fs`. Fully
   deterministic and trivially unit-tested.
2. **Use cases** (`hls/transcoder.ts`, `hls/audio.ts`, `hls/subtitle.ts`) —
   orchestrate the domain and call **ports**. Receive their dependencies via
   constructor/params (dependency injection), never `import` an adapter directly.
3. **Ports** (interfaces) — `ProbeService`, `FfmpegRunner`, `FileSystem`,
   `Clock`, `Logger`. Defined by the inner layers, implemented by the outer.
4. **Adapters** (`core/`) — concrete FFmpeg/ffprobe/child-process/FS
   implementations of the ports. The only place real I/O lives.
5. **Composition root** (`index.ts` / `builder/`) — wires real adapters into use
   cases. The public entry points.

**SOLID checklist for every module:**

- **S**ingle responsibility — one reason to change. Arg-building, progress
  parsing, playlist writing, and validation are *separate* units.
- **O**pen/closed — add a codec/rendition strategy without editing existing code
  (strategy objects, not `switch` sprawl).
- **L**iskov — any `FfmpegRunner`/`ProbeService` impl (real or fake) is
  substitutable; tests use fakes, prod uses adapters.
- **I**nterface segregation — narrow ports (`ProbeService` ≠ `FfmpegRunner`);
  consumers depend only on what they use.
- **D**ependency inversion — use cases depend on port *interfaces*, adapters
  depend on them too. No inner layer imports `core/`.

**Rule of thumb:** if a function both *decides* something and *does* I/O, split
it. The decision goes in the domain (pure, tested); the I/O goes in an adapter.

## Testing (mandatory — no exceptions)

- **Every function has a unit test.** PRs that add/modify a function without a
  test are incomplete. Target ≥ 90% line & branch coverage; coverage gate in CI.
- **Domain & validation tests run with zero FFmpeg.** Feed mock `SourceMetadata`
  and assert typed errors/decisions. These are the bulk of the suite and must be
  fast and deterministic.
- **Use-case tests inject fakes** for `FfmpegRunner`/`ProbeService`/`FileSystem`.
  Assert the *argv built*, the *ports called*, and the *events emitted* — not
  real transcoding.
- **Adapter tests** (thin) verify arg-building/stderr-parsing against recorded
  fixtures (saved ffprobe JSON, saved ffmpeg stderr samples). No live spawn.
- **E2E tests** (few, tagged, opt-in) run real FFmpeg on tiny fixture clips and
  assert playlists/segments exist and parse. Gated behind FFmpeg being present.
- **Structure:** co-locate `*.test.ts` beside the unit (or under `tests/`
  mirroring `src/`). One behavior per test; arrange-act-assert; no shared mutable
  state between tests.
- Prefer **testability by design** (pure functions + DI) over heavy mocking. If
  something is hard to test, the design is wrong — refactor, don't add mocks.

## Real-world input handling (proactive completeness — mandatory)

VHJS must handle **everything a real user throws at a transcoder**, not just the
happy path. Do not wait to be told about each edge case — anticipate them, flag
the gaps, and either handle them or record them in `TODO.md`. Shipping a feature
that only works on clean landscape MP4s is **not done**.

The standing checklist of real-world input concerns (extend as you find more):

- **Rotation / orientation.** Mobile videos store a rotation tag / Display-Matrix
  side-data; `ffprobe` reports the *stored* (not displayed) dimensions. ffmpeg's
  decoder auto-rotates by default (`-autorotate`, verified on 8.1.2 — even inside
  `-filter_complex`), so the *pixels* come out correct without an explicit
  `transpose`; do **not** add one (it double-rotates → sideways). But because
  ffprobe reports stored dims, read the rotation and drive the ladder + upscale
  check off *display* dimensions so they match the oriented output.
  **(handled — see `types/orientation.ts`; rotation note in `hls/command.ts`.)**
- **Non-even / odd dimensions.** H.264 requires even width & height — `scale=-2:H`
  forces an even width; rung heights are even. Keep it that way.
- **Any container.** We shell out, so mp4/mkv/avi/mov/webm/ts/flv all work; never
  gate on file extension. Only requirement: a decodable video stream.
- **Any source codec.** We always re-encode to H.264/AAC, so HEVC/AV1/VP9/etc.
  sources are fine — codec validation is about *output* codecs, not input.
- **Audio realities.** No audio track (video-only), multichannel (downmix to
  stereo), multiple/foreign-language tracks, missing bitrate metadata.
- **Missing / weird metadata.** Absent duration, bitrate, fps — already modelled
  as `| null`; never assume a field is present.
- **TODO (not yet handled):** variable frame rate (VFR) normalization; HDR /
  10-bit / wide-gamut (tonemap or at least `yuv420p`); anamorphic / non-square
  pixels (SAR/DAR); very-short/very-long sources. Track these in `TODO.md`.

## Guardrails for Claude

- The repo is essentially empty — you are building from scratch. Prefer small,
  reviewable PRs that each land one slice of the pipeline (see `TODO.md`).
- **Own the edge cases.** The user should not have to enumerate real-world inputs
  for you — see "Real-world input handling" above. Find them yourself.
- **No function without a unit test.** Write the test in the same change. Domain
  logic must be tested with fakes, never live FFmpeg.
- **Keep the dependency direction inward.** Never `import` from `core/` inside
  `hls/`, `validation/`, or `types/` — depend on a `ports/` interface and inject
  the adapter at the composition root.
- **Split decide-from-do.** Any function mixing a decision with I/O gets refactored.
- **Confirm the dev toolchain choice with the user before adding dependencies.**
- Don't invent FFmpeg flags — verify against installed `ffmpeg -h` / docs. When
  building filtergraphs, add a comment explaining the graph.
- Always go **probe → validate → run**. Validation must be unit-testable without
  spawning FFmpeg (feed it a mock `SourceMetadata`).
- When adding audio/subtitle tracks to an *existing* HLS package, parse the
  master playlist first and preserve existing renditions/groups.

---

## Status

**Phases 0 – 8 complete.** VHJS transcodes video to adaptive-bitrate HLS
end-to-end and now handles audio features (extract/demux + alternate-audio
packaging), verified on real FFmpeg (8.1.2). Highlights on top of the Phase 0–1
foundation (ports + fakes, branded types, `process`/`binaries`/`ffprobe`
adapters):

- **Validation** (`validation/`, pure, zero FFmpeg): full typed-error hierarchy
  (`ResolutionUpscaleError`, `BitrateExceedsSourceError`, `UnsupportedCodecError`,
  `TranscodeError`, `PlaylistParseError` + the Phase-1 set). `rules.ts` rejects
  upscales, clamps-and-warns bitrates near source (hard error only above
  `source × 1.5`), and rejects unsupported/absent codecs. Warnings ride a side
  channel (`types/warnings.ts`).
- **Domain output types**: `types/rendition.ts` (`Rendition` with H.264/AAC
  literal codecs, `RenditionOutput`, `TranscodeResult`, `renditionName`).
- **HLS use cases** (`hls/`, pure/domain): `ladder.ts` (auto + normalize),
  `command.ts` (pure `buildHlsCommand` → exact ffmpeg argv; **audio conditional**
  so audio-less sources don't fail), `transcoder.ts` (probe → validate → build →
  run → collect over injected ports; `dryRun`, progress, `AbortSignal`).
- **Adapters** (`core/`): `ffmpeg.ts` (`FfmpegRunner`, streams progress, bounded
  stderr tail), `progress.ts` (stderr → `ProgressEvent`), `fs.ts`, `clock.ts`.
- **Composition root** (`composition.ts`): `createVhjs(options)` factory resolves
  the binaries **once** and returns `{ probe, transcodeToHls,
  startTranscodeToHls }` (memoized) so callers don't re-pass options per call;
  thin `probe()`/`transcodeToHls()`/`startTranscodeToHls()` one-shot wrappers
  remain. Re-exported from `index.ts`.
- **Custom ffmpeg args** (early Phase-4 DX): `inputArgs`/`outputArgs` on a
  transcode request are injected verbatim (before `-i` / before the HLS muxer);
  a flag VHJS already manages is rejected up front with
  `ConflictingFfmpegArgError` (reserved-flag check in `hls/command.ts`).
- **Rotation / mobile video** (Phase 4.5): probe reads `VideoStream.rotation`
  (Display-Matrix side-data or legacy `rotate` tag); `types/orientation.ts`
  drives the ladder + upscale check off *display* dimensions. Pixels are rotated
  by ffmpeg's own default autorotation (no manual `transpose` — that would
  double-rotate); a real-FFmpeg e2e asserts a rotated source encodes portrait.
- **Public API & DX** (Phase 4): `types/config.ts` provides a discriminated
  `HlsJobConfig` (`ladder.mode: "auto" | "explicit"`) with compatibility for the
  original `renditions` request. `vhjs(input).output(dir)...run()` is an
  immutable fluent builder. `TranscodeJob` provides `EventEmitter` progress and
  `AsyncIterable` progress (`for await`), with the existing callback preserved.
- **Audio features** (Phase 5): `hls/audio.ts` — pure `buildAudioExtractCommand`
  (standalone-file demux, explicit `copy`|`aac` modes) + `buildAudioHlsCommand`
  (audio-only HLS rendition), plus the `extractAudio` / `addAudioTrack` use cases
  over injected ports. `addAudioTrack` segments an external audio file into its
  own media playlist and patches the master with an `EXT-X-MEDIA:TYPE=AUDIO`
  rendition referenced from every variant — reusing a `groupId` builds a
  multi-language group. Typed `NoAudioTrackError`; duration-sync
  (`AUDIO_DURATION_MISMATCH`) and `MUXED_AUDIO_PRESENT` warnings on the side
  channel. **Muxed-audio caveat:** VHJS base packages mux AAC into each variant;
  adding an alternate group over them is spec-legal but a clean alternate-audio
  setup uses video-only variants (surfaced via the warning; demux-restructuring
  is deferred).
- **Subtitle features** (Phase 6): `hls/subtitle.ts` — pure
  `buildSubtitleHlsCommand` emits an M3U8 segment list plus WebVTT segments;
  `createSubtitleTools` probes and validates a subtitle input, runs FFmpeg over
  injected ports, and patches the existing master. WebVTT is normalized and SRT
  is converted on ingest through `-c:s webvtt`. Repeated calls sharing a
  `groupId` create multi-language groups; `FORCED`, `DEFAULT`, and `AUTOSELECT`
  are exposed. Missing streams fail early with typed `NoSubtitleTrackError`.
- **Playlist** (`hls/playlist.ts`, pure): master `.m3u8`
  `parseMasterPlaylist`/`serializeMasterPlaylist` (attribute values kept verbatim
  for loss-free round-trip), media `parseMediaPlaylist`/`serializeMediaPlaylist`
  (segments, byte ranges, inherited/reset keys, and preserved unfamiliar tags),
  `addAlternateAudio` / `addAlternateSubtitle` patches (preserve existing
  renditions, bump `EXT-X-VERSION` ≥ 4), and `sumMediaPlaylistDurationMs`.
  Malformed input → `PlaylistParseError`.

> **Additional controls and package maintenance:** `frameRate` (branded) applies
> FFmpeg's `fps` filter and aligns GOP size; `preset` is a typed libx264 preset
> union. `hls/thumbnail.ts` probes first and rejects timestamps beyond duration
> before extracting one image. `hls/alternate-track.ts` soft-removes a selected
> `EXT-X-MEDIA` rendition or hard-removes its validated package-relative
> rendition directory, never following traversal or absolute playlist URIs.

> Note: the arg-builder lives in `hls/command.ts` (a pure *decision*), not
> `core/ffmpeg.ts`, per the mandatory "decision in the domain, I/O in an adapter"
> rule — so the inner layer never imports `core/`. `core/ffmpeg.ts` is now just
> the runner. This refines the target-layout table above.

Before the Phase 7 media-playlist additions, `typecheck` / `lint` / `test:cov`
(**252 unit tests, 100% lines/functions, 94.32% branch**, no live FFmpeg) /
`build` (`.mjs` + `.d.mts`) / `example`
(probe, basic-hls, abr-ladder, progress-events, dry-run, **extract-audio**,
**add-audio-track**, **add-subtitles**) / **`test:e2e`** (real FFmpeg 8.1.2: base transcode,
rotated-source-stays-portrait, upscale-rejected, robustness set, **audio
extract copy/aac + alternate-audio add**, **WebVTT segmentation + SRT conversion**;
self-skips when absent). FFmpeg
resolves from PATH or `VHJS_FFMPEG_PATH` / `VHJS_FFPROBE_PATH`.

> **Framework recipes (Phase 8):** `examples/frameworks/` contains isolated,
> copy-into-your-app Express, Fastify, NestJS, and Next.js recipes. Express and
> Next.js expose `TranscodeJob` progress through SSE; all four demonstrate a
> dedicated static HLS output root. Their dependencies are installed only by the
> host app, and `examples/` remains excluded from the published package.

> Audio examples need an input **with** an audio track (the bundled `1min.mp4` is
> audio-less); `examples/_env.ts` `audioSampleInput()` defaults to `mobile.mkv`,
> overridable via `VHJS_SAMPLE_AUDIO`.

Next: **Phase 8** — framework recipes and progress streaming examples. See
`TODO.md`.
