# TODO — VHJS Roadmap

Build order for **VHJS** (Video-HLS-JS). Ordered so each phase produces something
testable and the risky parts (probing, validation, FFmpeg arg-building) land early.
See `CLAUDE.md` for architecture and conventions.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · 🔴 must-have (MVP) · 🟡 should-have · 🟢 nice-to-have / roadmap

---

## ⛔ Definition of Done (applies to EVERY task below)
A task is not done until all of these hold — no exceptions:
- [ ] **Unit test for every function** added/changed (fast, deterministic, no live FFmpeg for domain/use-case logic).
- [ ] **Clean Code** — small single-purpose functions, intention-revealing names, no dead code, no `any` in public API.
- [ ] **SOLID + Clean Architecture** respected — inner layers depend on `ports/` interfaces, never on `core/` adapters; decisions separated from I/O.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` all green; coverage ≥ 90% line & branch.
- [ ] When a task adds a **user-facing feature**, add/update the matching `examples/` script so it can be exercised on real media locally.

---

## Phase 0 — Project setup 🔴 ✅
- [x] Decide & confirm dev toolchain with user: **`tsdown`** (build; Rolldown/oxc — replaced `tsup`), **`vitest` + `@vitest/coverage-v8`** (test + coverage gate), **`biome`** (lint+format), **`typedoc`** (docs), **`tsx`** (examples).
- [x] `tsconfig.json` — `strict`, `noUncheckedIndexedAccess`, `module: NodeNext`, `target: ES2023` (+ `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUnused*`). Dev-only `paths` alias `vhjs → src/index.ts`; separate `tsconfig.build.json` (paths-free) for the build.
- [x] Dev toolchain installed; zero runtime deps so far (footprint minimal).
- [x] `build` / `test` / `test:watch` / `test:cov` / `lint` / `lint:fix` / `format` / `typecheck` / `docs` / `example` scripts in `package.json`.
- [x] Coverage gate **≥ 90% line, branch, function, statement** in `vitest.config.ts` (binds once source logic lands; 0/0 today).
- [x] Architecture guard enforced two ways: Biome `noRestrictedImports` (forbids `src/hls`·`validation`·`types`·`ports` importing `core/`) **and** `tests/architecture.test.ts` (tool-independent backstop). Both verified to fire.
- [x] `.gitignore`, `LICENSE` (**MIT**), README skeleton. Git repo initialized (`main`).
- [x] Set up `examples/` as a local dev sandbox — examples import `vhjs` resolved to source (tsconfig `paths` for tsx, `resolve.alias` for vitest); `pnpm example <name>` runner (via `tsx`); `examples/` excluded from the published package (`files` allowlist = `dist`/`README`/`LICENSE`). `examples/00-hello.ts` smoke check passes. ✅
- [x] FFmpeg strategy decided: **system `PATH` + user override** (no bundled static binary).
- [x] CI (GitHub Actions): matrix over OS (win/mac/linux) — typecheck + lint + tests + coverage; separate FFmpeg-provisioned `e2e` job. (`.github/workflows/ci.yml`)

> Decisions locked this phase: **MIT** license; npm name **`vhjs`**; build tool **`tsdown`** (not `tsup`).
> Note: install must approve esbuild's build script — pnpm 11 uses `allowBuilds:` in `pnpm-workspace.yaml`.

## Phase 0.5 — Ports & test harness 🔴 ✅
- [x] `ports/index.ts` — interfaces `ProbeService`, `FfmpegRunner`, `FileSystem`, `Clock`, `Logger` (type-only; narrow per Interface Segregation).
- [x] In-memory **fakes** for every port under `tests/fakes/` (+ barrel): `FakeProbeService`, `FakeFfmpegRunner` (records argv, replays scripted progress/result/error), `FakeFileSystem` (map-backed), `FakeClock`, `FakeLogger`. All exercised by `tests/fakes/fakes.test.ts`.
- [x] `tests/fixtures/` — recorded ffprobe JSON (`1080p-h264-aac-subs.json`, `no-bitrate.json`), an ffmpeg progress-stderr sample (for Phase 3), and a `makeSourceMetadata(overrides)` factory. (Tiny e2e clips land with the Phase 3 e2e suite.)
- [x] Test pattern established (arrange-act-assert, one behavior per test, `it.each` for tables, injected fakes — no live FFmpeg).

## Phase 1 — FFmpeg/ffprobe foundation (adapters) 🔴 ✅
> These are **adapters** implementing the `ports/` interfaces from Phase 0.5. Only this layer touches `node:child_process`/`node:fs`.
- [x] `core/binaries.ts` — resolve ffmpeg & ffprobe from PATH or override; pure `*Candidate` decision fns + injected `VerifyBinary`; throws `FfmpegNotFoundError`/`FfprobeNotFoundError`; memoizing `createBinaryResolver` caches resolution; `createBinaryVerifier` builds the real `<cmd> -version` check over a `ProcessRunner`.
- [x] `core/process.ts` — promise `ProcessRunner` over injectable `spawn`: stdout/stderr capture, exit-code handling, `AbortSignal` cancellation, `timeoutMs`. Non-zero exit resolves (inspect `exitCode`); only spawn failure/abort rejects.
- [x] `core/ffprobe.ts` — implements `ProbeService`. Pure `parseProbeOutput` (raw JSON → `SourceMetadata`, tested via fixtures) split from `createFfprobeService` (I/O). Maps video/audio/subtitle streams, codecs, w/h, bitrate, fps, duration, channels/sample-rate/lang; ignores unmodelled stream kinds; typed `ProbeError` on bad exit/JSON/spawn.
- [x] `types/metadata.ts` (`SourceMetadata` + stream types), `types/brands.ts` (branded `Bitrate`/`Pixels`/`FrameRate`/`Milliseconds` + validating constructors), `types/progress.ts` (`ProgressEvent`). *(`Rendition` type lands with the ladder in Phase 3.)*
- [x] Unit tests with recorded ffprobe JSON fixtures — no live FFmpeg. (One tiny `node --version` run covers the default spawn path in `core/process`.)

> Also landed early (needed by the adapters): a Phase-1 subset of `validation/errors.ts` — base `VhjsError` (discriminant `code`) + `FfmpegNotFoundError`/`FfprobeNotFoundError`/`ProbeError`. The rest of the error hierarchy + rules land in **Phase 2**.
> Public barrel (`index.ts`) now re-exports the typed errors, metadata/progress types, and branded types + constructors. Coverage: 100% lines/functions, 98% branches (≥90% gate).

## Phase 2 — Validation layer 🔴 ✅
- [x] `validation/errors.ts` — base `VhjsError` + discriminated `code`; **all** error subclasses from `CLAUDE.md` now present (`ResolutionUpscaleError`, `BitrateExceedsSourceError`, `UnsupportedCodecError`, `TranscodeError`, `PlaylistParseError` on top of the Phase-1 binary/probe set).
- [x] `validation/rules.ts` — pure decisions over `SourceMetadata` + a requested `Rendition`:
  - [x] Reject **resolution upscale** (`assertNoUpscale`) → `ResolutionUpscaleError`.
  - [x] Bitrate policy = **clamp + warn** near source (`clampBitrate`); hard `BitrateExceedsSourceError` only above `source × hardExceedFactor` (default 1.5), video & audio; passes through unchanged when the source bitrate is unknown; video ref falls back to the container bitrate.
  - [x] Reject unsupported/absent codecs (`assertSupportedCodecs`, `primaryVideoStream`) → `UnsupportedCodecError`.
  - [x] Warning side channel (`ValidationWarning` in `types/warnings.ts`): `BITRATE_CLAMPED` here; `REDUNDANT_RENDITION` from the ladder.
- [x] Pure unit tests over mock `SourceMetadata` (via `makeSourceMetadata`/`makeRendition`) — **zero FFmpeg**.

## Phase 3 — Core HLS transcode (MVP) 🔴 ✅
- [x] `types/rendition.ts` — `Rendition` (H.264/AAC literal codecs), `RenditionOutput`, `TranscodeResult`, `renditionName`, supported-codec lists. *(The `Rendition` type deferred from Phase 1 lands here.)*
- [x] `hls/ladder.ts` — `autoLadder(source)` (standard rungs ≤ source height, bitrates clamped to source) + `normalizeLadder` (validate/clamp each rung, drop duplicate heights with a redundancy warning, sort highest-first). **Pure domain.**
- [x] `hls/command.ts` — pure `buildHlsCommand`: split+scale `-filter_complex`, per-stream `-c:v`/`-b:v`/`-maxrate`/`-bufsize`, per-stream `-c:a`/`-b:a`, `-hls_time`/`-hls_playlist_type`/`-hls_flags`/`-master_pl_name`/`-var_stream_map`, `%v` variant sub-dirs. **Audio is conditional** (`includeAudio`) so audio-less sources don't fail on `-map 0:a:0`. *(Arg-building is a pure decision → lives in the domain, not `core/`, per CLAUDE.md "decision in the domain, I/O in an adapter"; the layout table's `core/ffmpeg.ts` is now just the runner.)*
- [x] `core/ffmpeg.ts` — `createFfmpegRunner` adapter implementing the `FfmpegRunner` port: spawns via the injected `ProcessRunner`, streams parsed progress, retains a bounded stderr tail, rejects distinctly on abort.
- [x] `core/progress.ts` — pure `extractDuration`/`parseProgressLine`/`hmsToMs` + a stateful `createProgressParser` (latches `Duration:`, buffers `\r`-terminated chunks) → typed `ProgressEvent` (percent/time/fps/speed).
- [x] `hls/transcoder.ts` — orchestrates **probe → validate → build → run → collect** over injected ports; auto-ladder when none requested; logs warnings; returns `TranscodeResult`.
- [x] `dryRun` mode — returns the exact argv + ladder + master path without creating dirs or running ffmpeg (`isDryRun` guard).
- [x] Input/output handling — validates input exists (typed `ProbeError`), creates the output dir + one `stream_<name>/` per variant; all writes stay under `outputDir`.
- [x] `core/fs.ts` (`node:fs` `FileSystem` adapter) + `core/clock.ts` (`systemClock`) + `composition.ts` root wiring real adapters into `probe()` / `transcodeToHls()`.
- [x] E2E test (`tests/e2e/transcode.e2e.test.ts`, own `vitest.e2e.config.ts`, `pnpm test:e2e`): transcodes the bundled clip on **real FFmpeg**, asserts master + media playlists + segments exist and parse; self-skips when FFmpeg isn't resolvable. Verified green locally (FFmpeg 8.1.2).
- [x] Examples: `01-probe`, `02-basic-hls`, `03-abr-ladder` (live progress), `08-dry-run` — all run against the bundled clip; binaries via PATH or `VHJS_FFMPEG_PATH`/`VHJS_FFPROBE_PATH`.

## Phase 4 — Public API & DX 🔴 ✅
> Landed early (during Phase 3 follow-up): `createVhjs(options)` **instance API**
> (binaries resolved once, memoized; `{ probe, transcodeToHls }` reused without
> re-passing options) + one-shot `probe`/`transcodeToHls` wrappers; **custom
> ffmpeg args** (`inputArgs`/`outputArgs`, additive-only, `ConflictingFfmpegArgError`
> on collision with managed flags); **`AbortSignal`** wired end-to-end.
- [x] `types/config.ts` — `HlsJobConfig` as discriminated unions; sensible defaults.
- [x] `index.ts` — clean public surface: `createVhjs`/`transcodeToHls`/`probe` plus `startTranscodeToHls` and `vhjs` fluent entry points.
- [x] `builder/job-builder.ts` — optional fluent builder (`vhjs(input).output(dir).rendition(...).run()`).
- [x] Progress delivery: both `EventEmitter` and `AsyncIterable` through `TranscodeJob`. *(callback `onProgress` remains supported.)*
- [x] Cancellation via `AbortSignal` end-to-end.

## Phase 4.5 — Real-world input robustness 🟡
> Driven by the CLAUDE.md "Real-world input handling" mandate: a transcoder must
> survive whatever real users feed it, not just clean landscape MP4s.
- [x] **Rotation / mobile portrait video.** Probe reads `rotation` (Display-Matrix
  side-data → clockwise, legacy `rotate` tag fallback); `types/orientation.ts`
  `displayDimensions` drives the ladder + upscale check off *display* dims. **No
  transpose** — ffmpeg auto-rotates by default (verified ffmpeg 8.1.2, even in
  `-filter_complex`); a manual transpose double-rotated → sideways. E2E asserts a
  rotated source encodes portrait (width < height).
- [x] Container-agnostic inputs (mp4/mkv/avi/mov/webm/…) + any source codec
  (always re-encode to H.264/AAC) — no extension/codec gate on input.
- [x] Audio-less sources (video-only variants); multichannel downmix to stereo (`-ac 2`).
- [x] **Real-FFmpeg e2e coverage** for the above (`tests/e2e/robustness.e2e.test.ts`,
  self-contained — synthesizes its own inputs via `lavfi`, no committed media):
  non-H.264 source in a non-mp4 container → H.264/AAC; audio-less source (no audio
  maps); 5.1 → stereo downmix. Also verified manually against real local assets
  (`mobile.mkv`: VP9/Opus/portrait/60fps → correct portrait H.264/AAC).

> The remaining input-normalization filter work below is **deferred to the
> Roadmap** (needs real VFR/HDR/anamorphic source media to validate the filter
> chains end-to-end); the categories above are fully handled and e2e-covered.

## Phase 5 — Audio features 🔴/🟡 ✅
- [x] 🔴 Extract/demux audio from a video → standalone file ("spread audio"),
  two explicit modes: **`copy`** (verbatim bitstream) and **`aac`** (re-encode,
  stereo downmix). Pure `buildAudioExtractCommand` + `buildAudioHlsCommand`
  (audio-only HLS rendition) in `hls/audio.ts`; `extractAudio` use case over
  injected ports; typed `NoAudioTrackError` before FFmpeg runs.
- [x] 🔴 Add **extra audio track** to an *existing* HLS package as an
  `EXT-X-MEDIA:TYPE=AUDIO` alternate-audio rendition (language, name,
  default/autoselect flags) via `addAudioTrack`. Segments the audio into its own
  media playlist and patches the master, **preserving** existing renditions.
- [x] 🟡 Multi-language audio groups — repeated `addAudioTrack` calls with the
  same `groupId` accumulate into one group in the master playlist.
- [x] Validate added audio duration ≈ video duration (video duration summed from a
  variant's `#EXTINF`); `AUDIO_DURATION_MISMATCH` warning on drift beyond
  tolerance (`checkAudioDurationMatch`, pure). Also warns `MUXED_AUDIO_PRESENT`
  when the base package's variants still carry muxed audio.

> **Pulled forward from Phase 7:** the initial `hls/playlist.ts` work (master
> parse/serialize + `addAlternateAudio` patch + `#EXTINF` summer). The Phase-5
> slice was verified with:
> `typecheck`/`lint`/`test:cov` (234 unit tests, 100% lines/functions, 94% branch,
> no live FFmpeg), the `04-extract-audio`/`05-add-audio-track` examples, and
> `tests/e2e/audio.e2e.test.ts` on real FFmpeg 8.1.2.

## Phase 6 — Subtitle features 🔴/🟡 ✅
- [x] 🔴 Add **WebVTT subtitles** to an existing HLS package as an `EXT-X-MEDIA` subtitle rendition (segment the VTT, generate subtitle media playlist).
- [x] 🟡 Convert SRT → WebVTT on ingest.
- [x] 🟡 Multiple subtitle languages / forced-subtitle flag.

> `hls/subtitle.ts` keeps FFmpeg arg-building pure (`buildSubtitleHlsCommand`)
> and orchestrates probing, segmentation, and master patching over injected
> ports (`createSubtitleTools`). The segment muxer writes a VOD M3U8 plus
> WebVTT segments; `-c:s webvtt` normalizes WebVTT and converts SRT on ingest.
> `addAlternateSubtitle` preserves existing master content, accumulates
> languages by `groupId`, sets `FORCED`, and references the group from every
> variant. Verified by unit tests and real FFmpeg 8.1.2 E2E coverage.

## Phase 7 — Playlist manipulation 🔴
- [x] `hls/playlist.ts` — parse/serialize both master and **media** `.m3u8`
  playlists. The media model covers segments, `#EXTINF` duration/title, byte
  ranges, inherited/reset encryption keys, standard media fields, and preserved
  unfamiliar tags; malformed input raises `PlaylistParseError`.
- [x] Safely patch a master playlist: audio and subtitle `EXT-X-MEDIA` entries
  plus `AUDIO=` / `SUBTITLES=` references preserve existing renditions.
- [x] Round-trip tests (parse → serialize → parse) for master and media playlists.
- [x] Runnable `09-playlist-manipulation` example: inspect and reserialize a
  media playlist with byte ranges and key transitions (no FFmpeg required).

## Phase 8 — Framework friendliness 🟡
- [ ] Recipes/examples: Express, Fastify, NestJS, Next.js route handler.
- [ ] Example: stream progress to client via SSE/WebSocket.
- [ ] Example: serve generated HLS statically.
- [ ] Ensure zero framework deps leak into core bundle.

## Phase 9 — Docs, examples, release 🟡
- [ ] README with quickstart + full API table.
- [ ] `typedoc` API reference.
- [ ] Flesh out `examples/` runnable scripts (see `examples/README.md` for the planned set: probe, basic HLS, ABR ladder, extract audio, add audio track, add subtitles, progress+cancel, dry-run) + framework recipes.
- [ ] Smoke-run examples in CI where feasible so they can't silently rot.
- [ ] Semantic versioning + `CHANGELOG.md`; publish config; `exports` map for ESM.
- [ ] Publish `0.1.0` once Phases 1–4 are green.

---

## Roadmap / stretch 🟢
- [ ] **Input-normalization filter chain** (moved from Phase 4.5 — needs real
  source media to validate each filter chain end-to-end):
  - [ ] 🟡 Variable frame rate (VFR) — detect (`r_frame_rate` vs `avg_frame_rate`)
    and normalize with the `fps` filter / `-fps_mode cfr` for stable segments.
  - [ ] 🟡 HDR / 10-bit / wide-gamut — tonemap to SDR (`zscale`+`tonemap`, needs an
    FFmpeg built with libzimg) or at minimum force `format=yuv420p` for compatibility.
  - [ ] 🟡 Anamorphic / non-square pixels (SAR/DAR) — scale to square-pixel display
    dims (`scale=<dispW>:<h>,setsar=1`).
  - [ ] 🟢 Multiple / foreign-language audio tracks — select or expose all.
- [ ] Hardware acceleration: NVENC / QSV / VideoToolbox / AMF (auto-detect + opt-in).
- [ ] fMP4 / CMAF segments (`-hls_segment_type fmp4`) + low-latency HLS.
- [ ] Encryption: AES-128 and SAMPLE-AES key delivery.
- [ ] DASH output alongside HLS (shared segments where possible).
- [ ] Thumbnail / storyboard (WebVTT `EXT-X-IMAGE-STREAM-INF`) generation.
- [ ] Concurrency control / job queue for many renditions or many jobs.
- [ ] Resumable / restartable jobs; idempotent re-runs.
- [ ] Pluggable storage backend (write segments to S3/GCS instead of local FS).
- [ ] Two-pass encoding option for better bitrate accuracy.
- [ ] Per-rendition keyframe alignment across the ladder (seamless ABR switching).

---

## Decisions (locked)
- [x] FFmpeg: **system `PATH` + override** (not bundled).
- [x] Default codecs: **H.264 + AAC** (others opt-in later).
- [x] Bitrate near source: **clamp + warn** (hard error only when clearly above).
- [x] License: **MIT**.
- [x] Package/npm name: **`vhjs`** (lowercased from `VHJS`).
- [x] Build tool: **`tsdown`** (Rolldown-based successor to `tsup`).
