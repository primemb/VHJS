/**
 * VHJS — public API surface (single entry, re-exports only).
 *
 * The real API lands across Phases 1–4 (see TODO.md): `transcodeToHls`,
 * `probe`, the fluent builder, progress events, and the typed error hierarchy.
 * For now this barrel exposes only the version marker so the package builds,
 * typechecks, and the examples dev-link can be verified end-to-end.
 */
export const VHJS_VERSION = "0.1.0";
