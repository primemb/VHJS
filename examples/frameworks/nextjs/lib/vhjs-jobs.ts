import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createVhjs, type TranscodeJob, type TranscodeOutcome } from "vhjs";

const hlsRoot = resolve(process.cwd(), "public", "hls");
const client = createVhjs();
type JobRecord = {
  readonly job: TranscodeJob;
  state: "running" | "complete" | "failed";
  result?: TranscodeOutcome;
  error?: unknown;
};

const jobs = new Map<string, JobRecord>();

export async function startTranscode(input: string) {
  await mkdir(hlsRoot, { recursive: true });
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
  return { id, playlistUrl: `/hls/${id}/master.m3u8` };
}

export function getTranscode(id: string) {
  return jobs.get(id);
}
