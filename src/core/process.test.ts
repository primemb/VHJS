import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProcessRunner, type ProcessResult, type SpawnFn } from "./process.js";

/**
 * A minimal stand-in for `ChildProcess`: stdout/stderr are emitters, `kill`
 * records the signal it was asked to send. Tests drive the lifecycle by
 * emitting `data`/`close`/`error` events by hand.
 */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly killSignals: Array<NodeJS.Signals | number> = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal ?? "SIGTERM");
    return true;
  }
}

function fakeSpawn(): {
  spawnFn: SpawnFn;
  child: FakeChild;
  calls: Array<[string, readonly string[]]>;
} {
  const child = new FakeChild();
  const calls: Array<[string, readonly string[]]> = [];
  const spawnFn: SpawnFn = (command, args) => {
    calls.push([command, args]);
    // biome-ignore lint/suspicious/noExplicitAny: fake child implements only what the runner touches
    return child as any;
  };
  return { spawnFn, child, calls };
}

describe("createProcessRunner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes command + args to spawn and captures stdout/stderr", async () => {
    const { spawnFn, child, calls } = fakeSpawn();
    const run = createProcessRunner(spawnFn);
    const outChunks: string[] = [];

    const promise = run("ffprobe", { args: ["-version"], onStdout: (c) => outChunks.push(c) });
    child.stdout.emit("data", Buffer.from("hello "));
    child.stdout.emit("data", "world");
    child.stderr.emit("data", "warn");
    child.emit("close", 0, null);

    const result = await promise;
    expect(calls[0]).toEqual(["ffprobe", ["-version"]]);
    expect(result).toMatchObject<Partial<ProcessResult>>({
      exitCode: 0,
      stdout: "hello world",
      stderr: "warn",
      timedOut: false,
      aborted: false,
    });
    expect(outChunks).toEqual(["hello ", "world"]);
  });

  it("resolves (not rejects) on a non-zero exit", async () => {
    const { spawnFn, child } = fakeSpawn();
    const run = createProcessRunner(spawnFn);
    const promise = run("ffmpeg");
    child.emit("close", 1, null);
    await expect(promise).resolves.toMatchObject({ exitCode: 1 });
  });

  it("rejects when the process cannot be spawned", async () => {
    const { spawnFn, child } = fakeSpawn();
    const run = createProcessRunner(spawnFn);
    const promise = run("nope");
    child.emit("error", new Error("ENOENT"));
    await expect(promise).rejects.toThrow("ENOENT");
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const { spawnFn, calls } = fakeSpawn();
    const run = createProcessRunner(spawnFn);
    const controller = new AbortController();
    controller.abort(new Error("pre-aborted"));
    await expect(run("ffmpeg", { signal: controller.signal })).rejects.toThrow("pre-aborted");
    expect(calls).toHaveLength(0);
  });

  it("uses a generic reason when aborted without an Error reason", async () => {
    const { spawnFn } = fakeSpawn();
    const run = createProcessRunner(spawnFn);
    const controller = new AbortController();
    controller.abort("just a string");
    await expect(run("ffmpeg", { signal: controller.signal })).rejects.toThrow(
      /aborted before it started/,
    );
  });

  it("kills the child and flags aborted when the signal fires mid-run", async () => {
    const { spawnFn, child } = fakeSpawn();
    const run = createProcessRunner(spawnFn);
    const controller = new AbortController();
    const promise = run("ffmpeg", { signal: controller.signal });

    controller.abort();
    expect(child.killSignals).toEqual(["SIGKILL"]);
    child.emit("close", null, "SIGKILL");

    await expect(promise).resolves.toMatchObject({ aborted: true, timedOut: false });
  });

  it("kills the child and flags timedOut when the deadline passes", async () => {
    vi.useFakeTimers();
    const { spawnFn, child } = fakeSpawn();
    const run = createProcessRunner(spawnFn);
    const promise = run("ffmpeg", { timeoutMs: 1000 });

    vi.advanceTimersByTime(1000);
    expect(child.killSignals).toEqual(["SIGKILL"]);
    child.emit("close", null, "SIGKILL");

    await expect(promise).resolves.toMatchObject({ timedOut: true });
  });

  it("ignores a late second close/error after settling", async () => {
    const { spawnFn, child } = fakeSpawn();
    const run = createProcessRunner(spawnFn);
    const promise = run("ffmpeg");
    child.emit("close", 0, null);
    // Late events must not throw or change the already-resolved result.
    child.emit("close", 1, null);
    child.emit("error", new Error("late"));
    await expect(promise).resolves.toMatchObject({ exitCode: 0 });
  });

  it("runs a real process through the default spawn (node --version)", async () => {
    const run = createProcessRunner();
    const result = await run(process.execPath, { args: ["--version"] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("v");
  });
});
