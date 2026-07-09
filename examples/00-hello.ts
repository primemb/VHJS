/**
 * Smoke check for the local dev loop: proves that importing `vhjs` resolves to
 * the workspace source (src/index.ts), so edits are picked up immediately.
 *
 * Run: `pnpm example 00-hello`
 */
import { VHJS_VERSION } from "vhjs";

console.log(`VHJS ${VHJS_VERSION} — dev link OK, source imports resolve. 🎬`);
