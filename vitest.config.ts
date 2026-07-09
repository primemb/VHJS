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
      // Barrels, type-only, and generated files carry no testable logic.
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/**/*.d.ts", "src/types/**"],
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
