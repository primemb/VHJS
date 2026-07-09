import { defineConfig } from "vitest/config";

// Coverage gate is a hard CI failure below threshold (CLAUDE.md: >=90% line & branch).
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // E2E (real FFmpeg) runs via its own config — `pnpm test:e2e`.
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      // Barrels, the composition root, and generated declarations carry no
      // testable branching logic — they wire real adapters and are exercised by
      // the examples + opt-in e2e suite. Type-only modules (metadata/progress/
      // ports) stay included but report as no-ops; `types/brands.ts` and
      // `types/rendition.ts` have real runtime code and ARE covered.
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/composition.ts", "src/**/*.d.ts"],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      // Let tests import the package by name, resolved to source.
      vhjs: new URL("./src/index.ts", import.meta.url).pathname,
    },
  },
});
