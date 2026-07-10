/**
 * Fastify + VHJS: asynchronous transcodes and static HLS files.
 *
 * In a separate Fastify app:
 *   pnpm add fastify @fastify/static vhjs
 *   pnpm add -D typescript tsx
 *   npx tsx server.ts
 */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import fastify from "fastify";
import { createVhjs } from "vhjs";

const app = fastify();
const client = createVhjs();
const hlsRoot = resolve(process.cwd(), "hls-output");

await mkdir(hlsRoot, { recursive: true });
await app.register(fastifyStatic, { prefix: "/hls/", root: hlsRoot });

app.post<{ Body: { input?: unknown } }>("/transcodes", async (request, reply) => {
  const input = request.body?.input;
  if (typeof input !== "string" || input.length === 0) {
    return reply.status(400).send({ error: "input must be a non-empty server-side path" });
  }

  const id = randomUUID();
  const job = client.startTranscodeToHls({ input, outputDir: resolve(hlsRoot, id) });
  // Attach a rejection handler even when this minimal recipe does not retain job state.
  void job.result.catch(() => undefined);
  return reply.status(202).send({ id, playlistUrl: `/hls/${id}/master.m3u8` });
});

await app.listen({ port: 3000 });
