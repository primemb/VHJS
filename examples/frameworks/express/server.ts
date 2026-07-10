/**
 * Express + VHJS: asynchronous transcodes, SSE progress, and static HLS files.
 *
 * In a separate Express app:
 *   pnpm add express vhjs
 *   pnpm add -D @types/express typescript tsx
 *   npx tsx server.ts
 */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import express from "express";
import {
  createVhjs,
  isDryRun,
  type ProgressEvent,
  type TranscodeJob,
  type TranscodeOutcome,
} from "vhjs";

const app = express();
const client = createVhjs();
const hlsRoot = resolve(process.cwd(), "hls-output");
type JobRecord = {
  readonly job: TranscodeJob;
  state: "running" | "complete" | "failed";
  result?: TranscodeOutcome;
  error?: unknown;
};

const jobs = new Map<string, JobRecord>();

await mkdir(hlsRoot, { recursive: true });
app.use(express.json());
app.use("/hls", express.static(hlsRoot));

app.post("/transcodes", (request, response) => {
  const input = request.body?.input;
  if (typeof input !== "string" || input.length === 0) {
    response.status(400).json({ error: "input must be a non-empty server-side path" });
    return;
  }

  const id = randomUUID();
  const job = client.startTranscodeToHls({ input, outputDir: resolve(hlsRoot, id) });
  const record: JobRecord = { job, state: "running" };
  jobs.set(id, record);
  void job.result.then(
    (result) => {
      record.state = "complete";
      record.result = result;
    },
    (error) => {
      record.state = "failed";
      record.error = error;
    },
  );

  response.status(202).json({ id, playlistUrl: `/hls/${id}/master.m3u8` });
});

app.get("/transcodes/:id/events", (request, response) => {
  const record = jobs.get(request.params.id);
  if (!record) {
    response.status(404).json({ error: "unknown transcode" });
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  });
  response.flushHeaders();
  const send = (event: string, data: unknown) =>
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const onProgress = (event: ProgressEvent) => send("progress", event);
  const onComplete = (result: TranscodeOutcome) => {
    send("complete", isDryRun(result) ? result : { masterPlaylistPath: result.masterPlaylistPath });
    response.end();
  };
  const onFailed = (error: unknown) => {
    send("failed", { message: error instanceof Error ? error.message : "Transcode failed" });
    response.end();
  };
  record.job.on("progress", onProgress);
  record.job.once("complete", onComplete);
  record.job.once("failed", onFailed);

  if (record.state === "complete" && record.result) onComplete(record.result);
  if (record.state === "failed") onFailed(record.error);
  request.on("close", () => {
    record.job.off("progress", onProgress);
    record.job.off("complete", onComplete);
    record.job.off("failed", onFailed);
  });
});

app.listen(3000, () => console.log("VHJS Express recipe: http://localhost:3000"));
