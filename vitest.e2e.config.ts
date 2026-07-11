import { defineConfig } from "vitest/config";

/**
 * E2E config — opt-in, real-FFmpeg tests only (`pnpm test:e2e`). These spawn
 * ffmpeg/ffprobe on tiny fixtures and self-skip when the binaries aren't
 * resolvable, so they never run in the default unit suite (no coverage gate).
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    // Real transcodes take seconds, not milliseconds.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@primemb/vhjs": new URL("./src/index.ts", import.meta.url).pathname,
    },
  },
});
