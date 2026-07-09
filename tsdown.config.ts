import { defineConfig } from "tsdown";

// Single ESM entry; tsdown (Rolldown + oxc) bundles JS and generates .d.ts.
// Built against tsconfig.build.json — the `vhjs` path alias in the root
// tsconfig is dev-only (examples/tests) and the published build never needs it.
// The public API surface is re-exported from src/index.ts (see CLAUDE.md).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  tsconfig: "tsconfig.build.json",
});
