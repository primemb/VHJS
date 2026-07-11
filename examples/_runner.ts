/**
 * Example runner used by `pnpm example <name>`.
 *
 * Resolves a bare example name (e.g. `00-hello` or `03-abr-ladder`) to
 * `examples/<name>.ts` and imports it by its published name (`@primemb/vhjs`),
 * which tsx resolves to `src/index.ts` via tsconfig `paths` — so they run
 * against the live source, not a built package.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const name = process.argv[2];
if (!name) {
  console.error("Usage: pnpm example <name>   (e.g. pnpm example 00-hello)");
  process.exit(1);
}

const file = name.endsWith(".ts") ? name : `${name}.ts`;
const full = resolve(here, file);

if (!existsSync(full)) {
  console.error(`Example not found: ${full}`);
  process.exit(1);
}

await import(pathToFileURL(full).href);
