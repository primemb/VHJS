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

## Phase 0.5 — Ports & test harness 🔴
- [ ] `ports/index.ts` — define interfaces: `FfmpegRunner`, `ProbeService`, `FileSystem`, `Clock`, `Logger`.
- [ ] Author in-memory **fakes** for every port under `tests/fakes/` (fake runner records argv & emits scripted progress; fake FS is a map).
- [ ] `tests/fixtures/` — recorded ffprobe JSON + ffmpeg stderr samples; tiny (<1s) e2e clips.
- [ ] Establish the test pattern (arrange-act-assert, one behavior per test) as the template for all later phases.

## Phase 1 — FFmpeg/ffprobe foundation (adapters) 🔴
> These are **adapters** implementing the `ports/` interfaces from Phase 0.5. Only this layer touches `node:child_process`/`node:fs`.
- [ ] `core/binaries.ts` — resolve ffmpeg & ffprobe from PATH or user override; throw `FfmpegNotFoundError`/`FfprobeNotFoundError` if missing; cache resolution.
- [ ] `core/process.ts` — spawn wrapper: stdout/stderr capture, exit-code handling, `AbortSignal` cancellation, timeout.
- [ ] `core/ffprobe.ts` — implements `ProbeService`: probe input → `SourceMetadata` (streams, codecs, width/height, bitrate, fps, duration, audio channels/lang, subtitle streams). Pure JSON→metadata parsing split out so it's testable without spawning.
- [ ] `types/metadata.ts`, `types/brands.ts` — `SourceMetadata`, `Rendition`, branded `Resolution`/`Bitrate`.
- [ ] Unit tests with recorded ffprobe JSON fixtures (no live FFmpeg needed).

## Phase 2 — Validation layer 🔴
- [ ] `validation/errors.ts` — base `VhjsError` + discriminated `code`; all error subclasses from `CLAUDE.md`.
- [ ] `validation/rules.ts`:
  - [ ] Reject **resolution upscale** (requested height > source) → `ResolutionUpscaleError`.
  - [ ] Bitrate policy = **clamp + warn** near source; hard `BitrateExceedsSourceError` only when clearly above source (video & audio).
  - [ ] Reject unsupported/absent codecs → `UnsupportedCodecError`.
  - [ ] Emit a warning channel for clamped/redundant renditions.
- [ ] Pure unit tests over mock `SourceMetadata` — **zero FFmpeg dependency**.

## Phase 3 — Core HLS transcode (MVP) 🔴
- [ ] `hls/ladder.ts` — normalize/clamp a requested ABR ladder against source; auto-ladder helper (e.g. from 1080p source → 1080/720/480).
- [ ] `core/ffmpeg.ts` — build HLS argv for a ladder (`-map`, `-c:v`, `-b:v`, `-c:a`, `-b:a`, `-hls_time`, `-hls_playlist_type`, `-master_pl_name`, `-var_stream_map`, segment naming).
- [ ] `core/progress.ts` — parse ffmpeg progress → typed progress events (percent from duration, fps, speed, current rendition).
- [ ] `hls/transcoder.ts` — orchestrate: probe → validate → build args → run → collect outputs → `TranscodeResult`.
- [ ] `dryRun` mode — return the exact argv without executing.
- [ ] Input/output location handling — validate input exists; create/validate output dir (never write outside it).
- [ ] E2E test: transcode a small fixture to HLS, assert master + media playlists + segments exist and play-parse cleanly.

## Phase 4 — Public API & DX 🔴
- [ ] `types/config.ts` — `HlsJobConfig` as discriminated unions; sensible defaults.
- [ ] `index.ts` — clean public surface: `transcodeToHls(config)`, `probe(input)`, plus event/`AsyncIterable` progress.
- [ ] `builder/job-builder.ts` — optional fluent builder (`vhjs(input).output(dir).rendition(...).run()`).
- [ ] Progress delivery: both `EventEmitter` and `AsyncIterable` (framework-neutral).
- [ ] Cancellation via `AbortSignal` end-to-end.

## Phase 5 — Audio features 🔴/🟡
- [ ] 🔴 Extract/demux audio from a video → standalone file and/or dedicated audio rendition ("spread audio").
- [ ] 🔴 Add **extra audio track** to an *existing* HLS package as an `EXT-X-MEDIA` alternate-audio rendition (language, name, default/autoselect flags).
- [ ] 🟡 Multi-language audio groups in the master playlist.
- [ ] Validate added audio duration ≈ video duration; warn on mismatch.

## Phase 6 — Subtitle features 🔴/🟡
- [ ] 🔴 Add **WebVTT subtitles** to an existing HLS package as an `EXT-X-MEDIA` subtitle rendition (segment the VTT, generate subtitle media playlist).
- [ ] 🟡 Convert SRT → WebVTT on ingest.
- [ ] 🟡 Multiple subtitle languages / forced-subtitle flag.

## Phase 7 — Playlist manipulation 🔴
- [ ] `hls/playlist.ts` — parse existing master + media `.m3u8` (→ `PlaylistParseError` on malformed).
- [ ] Safely patch a master playlist to add audio/subtitle `EXT-X-MEDIA` + reference from `EXT-X-STREAM-INF` without clobbering existing renditions.
- [ ] Round-trip tests (parse → serialize → parse).

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
