# VHJS contributor guide

VHJS is a TypeScript-first, framework-agnostic Node.js library that creates
adaptive-bitrate HLS packages through FFmpeg. It probes a source, validates the
requested operation, then runs FFmpeg and writes or patches playlists.

Keep this file current when the architecture or engineering rules change.
Product scope and planned work belong in [TODO.md](TODO.md); user-facing usage
belongs in [README.md](README.md) and [examples/README.md](examples/README.md).

## Release status

The implementation, examples, API docs configuration, and CI smoke checks are
ready for `0.2.0`. The remaining release action is an authorized `npm publish`.
Do not publish or change the package version without explicit maintainer approval.

## Toolchain and commands

- Node.js `>=22` (`.nvmrc` records the development version).
- ESM-only TypeScript (`module: NodeNext`); use `.js` extensions in relative
  import specifiers.
- pnpm 11, tsdown, Vitest, Biome, TypeDoc, and tsx.
- FFmpeg and ffprobe are external binaries resolved from `PATH` or caller
  overrides; they are never bundled.

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test:cov
pnpm test:e2e       # requires FFmpeg; CI provisions it
pnpm docs           # writes docs/api/
pnpm example <name>
```

For a code change, run typecheck, lint, and unit coverage. Run the relevant
example and e2e suite when changing FFmpeg behavior, filesystem behavior, or a
public workflow.

## Architecture

Dependency direction is inward:

```text
types <- validation <- hls use cases <- composition / builder / public API
                              |
                         ports <- core adapters
```

| Layer | Responsibility |
| --- | --- |
| `types/` | Public input/output shapes and branded scalars. |
| `validation/` | Pure policies and typed errors. |
| `hls/` | Pure command/playlist decisions and use cases over ports. |
| `ports/` | Narrow interfaces for probe, FFmpeg, filesystem, clock, and logging. |
| `core/` | Node/FFmpeg adapters; the only layer allowed to import `node:fs` or `node:child_process`. |
| `composition.ts` | Wires real adapters into the public API. |
| `builder/` | Optional fluent API and streaming job wrapper. |

`hls/`, `validation/`, and `types/` must never import `core/`. Split decisions
from I/O: command construction and validation are pure, while adapters perform
filesystem and process work.

## Public behavior to preserve

- Probe before validating or running FFmpeg; errors extend `VhjsError` and carry
  a discriminating `code`.
- Default output codecs are H.264 video and AAC audio.
- Validate requested output against display dimensions (including source
  rotation); do not upscale. Clamp near-source bitrates and warn; only clearly
  excessive requests throw.
- Do not assume a container, source codec, bitrate, duration, frame rate, or
  audio stream exists. Audio-less sources remain valid video-only HLS output;
  multichannel audio is downmixed where VHJS re-encodes it.
- Keep H.264 output dimensions even. FFmpeg auto-rotation already handles mobile
  orientation; do not add a manual transpose filter.
- Every FFmpeg operation needs an inspectable dry run. Custom arguments are
  additive only and must not override VHJS-managed flags.
- Parse an existing master playlist before adding or removing alternate tracks;
  preserve unrelated renditions and reject unsafe paths before hard deletion.

Known normalization work still belongs in the roadmap: VFR normalization,
HDR/wide-gamut handling, anamorphic source handling, and broader multi-audio
selection.

## Testing and quality

- Add or update a deterministic unit test for every changed function.
- Test pure domain/validation logic with fixtures and fakes, never live FFmpeg.
- Use port fakes for use cases; assert decisions, argv, port calls, and events.
- Keep real-FFmpeg tests small and isolated in `tests/e2e/`.
- Maintain the configured coverage threshold (at least 90% for all metrics).
- Keep public APIs free of `any`; prefer readonly values, discriminated unions,
  and branded types.
- Preserve cross-platform paths with `node:path`. All writes must stay within
  the caller-selected output/package directory.

## Examples, docs, and publishing

Examples run against source and are not published. Keep them clear and runnable;
the no-media examples are smoke-tested in CI. Framework recipes are copy-into-
your-app samples and must not introduce framework dependencies into the package.

When public behavior changes, update the README API table, an appropriate
example, TypeDoc comments, and `CHANGELOG.md`. Keep `package.json` ESM exports
and the published-files allowlist aligned with build output. Do not commit
generated `dist/`, coverage, or `docs/api/` artifacts.
