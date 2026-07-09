/**
 * Clean Architecture invariant (CLAUDE.md): inner layers must never import the
 * `core/` adapters — dependencies point inward via `ports/` interfaces, wired
 * at the composition root. Biome enforces this too (biome.json overrides); this
 * test is the cross-platform, tool-independent backstop and documents the rule.
 *
 * It scans real source files, so it starts passing trivially (no inner-layer
 * files yet) and tightens automatically as Phases 0.5+ add them.
 */
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Directories whose files may not depend on `core/` (the adapters). */
const INNER_LAYERS = ["src/hls", "src/validation", "src/types", "src/ports"];

/** Matches any import specifier pointing into a `core/` directory. */
const CORE_IMPORT = /from\s+["'][^"']*\bcore\/[^"']*["']/;

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of glob(`${dir}/**/*.ts`, { cwd: repoRoot })) {
    out.push(entry);
  }
  return out;
}

describe("architecture: inner layers do not import core/", () => {
  it("has no forbidden core/ imports in inner layers", async () => {
    const offenders: string[] = [];

    for (const layer of INNER_LAYERS) {
      for (const file of await filesUnder(layer)) {
        const source = readFileSync(resolve(repoRoot, file), "utf8");
        if (CORE_IMPORT.test(source)) {
          offenders.push(file);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
