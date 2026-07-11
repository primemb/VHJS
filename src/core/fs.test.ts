import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNodeFileSystem } from "./fs.js";

const fs = createNodeFileSystem();
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "vhjs-fs-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createNodeFileSystem", () => {
  it("reports existence of files and directories", async () => {
    expect(await fs.exists(join(root, "nope.txt"))).toBe(false);
    expect(await fs.exists(root)).toBe(true);
  });

  it("creates nested directories idempotently", async () => {
    const nested = join(root, "a", "b", "c");
    await fs.mkdirp(nested);
    await fs.mkdirp(nested); // no throw on second call
    expect(await fs.exists(nested)).toBe(true);
  });

  it("writes and reads a file round-trip", async () => {
    const file = join(root, "hello.txt");
    await fs.writeFile(file, "hi there");
    expect(await fs.readFile(file)).toBe("hi there");
    expect(await fs.exists(file)).toBe(true);
  });

  it("lists directory entries", async () => {
    const dir = join(root, "listing");
    await fs.mkdirp(dir);
    await fs.writeFile(join(dir, "one.ts"), "");
    await fs.writeFile(join(dir, "two.ts"), "");
    expect((await fs.readDir(dir)).sort()).toEqual(["one.ts", "two.ts"]);
  });

  it("removes a directory tree", async () => {
    const dir = join(root, "removal", "nested");
    await fs.mkdirp(dir);
    await fs.writeFile(join(dir, "segment.ts"), "data");

    await fs.removeDir(join(root, "removal"));

    expect(await fs.exists(join(root, "removal"))).toBe(false);
  });
});
