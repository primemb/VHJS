/**
 * Stream a transcode's progress through both EventEmitter and AsyncIterable.
 *
 * Run: `pnpm example 07-progress-events`
 */
import { createVhjs, isDryRun } from "vhjs";
import { binaryOptions, outputDir, sampleInput } from "./_env.js";

const client = createVhjs(binaryOptions());
const job = client.startTranscodeToHls({
  input: sampleInput(),
  outputDir: outputDir("progress-events"),
});

// EventEmitter is useful when wiring the job into an existing Node event flow.
job.on("progress", (event) => {
  const percent = event.percent === null ? "?" : `${event.percent}`;
  process.stdout.write(`\r[event] ${percent}%`);
});

// AsyncIterable works naturally with async application code and streams every
// event observed after iteration begins.
const progress = (async () => {
  for await (const event of job) {
    const percent = event.percent === null ? "?" : `${event.percent}`;
    process.stdout.write(`\r[async] ${percent}%`);
  }
})();

const result = await job.result;
await progress;
process.stdout.write("\n");

if (isDryRun(result)) {
  throw new Error("unexpected dry run");
}
console.log(`Master playlist: ${result.masterPlaylistPath}`);
