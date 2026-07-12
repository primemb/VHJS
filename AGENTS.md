# AGENTS.md

Use [CLAUDE.md](CLAUDE.md) for the project architecture and non-negotiable
engineering rules. This file defines the working contract for agents.

## Before editing

- Read the relevant source, adjacent tests, and the matching public docs/example.
- Check [TODO.md](TODO.md) for scope; do not treat old status prose as a source
  of truth.
- Preserve unrelated working-tree changes.

## Local runtime

- Node.js is managed through FNM. Before running `pnpm`, initialize FNM in the
  current shell so it activates the version from `.nvmrc`:
  - PowerShell: `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression`
  - Git Bash: `eval "$(fnm env --use-on-cd --shell bash)"`

## Implementation rules

- Keep dependency direction inward: `hls/`, `validation/`, and `types/` never
  import `core/`; use `ports/` and composition instead.
- Separate pure decisions from I/O. Keep FFmpeg argv builders, validation, and
  playlist transforms deterministic.
- Add or update a unit test for every changed function. Use fakes for ports and
  reserve real FFmpeg for focused e2e coverage.
- Use ESM `.js` relative imports, strict public types, and cross-platform
  `node:path` handling.
- Do not add runtime dependencies or alter release/version/publish settings
  without explicit user approval.

## Finish checklist

- Run `pnpm typecheck`, `pnpm lint`, and `pnpm test:cov`; run focused e2e and
  examples when the affected workflow needs FFmpeg or user-facing verification.
- Update README, examples, TypeDoc comments, `CHANGELOG.md`, and `TODO.md` only
  when the change makes them inaccurate.
- Never commit generated `dist/`, coverage, or `docs/api/` output.
- Do not run `npm publish`; it requires explicit maintainer authorization.
