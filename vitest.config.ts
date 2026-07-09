import { defineConfig } from "vitest/config";

// Coverage gate is a hard CI failure below threshold (CLAUDE.md: >=90% line & branch).
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      // Barrels and generated declarations carry no testable logic. Type-only
      // modules (metadata/progress/ports) stay included but report as no-ops;
      // `types/brands.ts` has real runtime constructors and IS covered.
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/**/*.d.ts"],
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
