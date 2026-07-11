import { isDryRun, type ProgressEvent, type TranscodeOutcome } from "@primemb/vhjs";
import { getTranscode } from "../../../../../lib/vhjs-jobs.js";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = getTranscode(id);
  if (!record) return Response.json({ error: "unknown transcode" }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const onProgress = (event: ProgressEvent) => send("progress", event);
      const onComplete = (result: TranscodeOutcome) => {
        send(
          "complete",
          isDryRun(result) ? result : { masterPlaylistPath: result.masterPlaylistPath },
        );
        record.job.off("progress", onProgress);
        controller.close();
      };
      const onFailed = (error: unknown) => {
        send("failed", { message: error instanceof Error ? error.message : "Transcode failed" });
        record.job.off("progress", onProgress);
        controller.close();
      };
      const cleanup = () => {
        record.job.off("progress", onProgress);
        record.job.off("complete", onComplete);
        record.job.off("failed", onFailed);
      };
      record.job.on("progress", onProgress);
      record.job.once("complete", onComplete);
      record.job.once("failed", onFailed);
      if (record.state === "complete" && record.result) onComplete(record.result);
      if (record.state === "failed") onFailed(record.error);
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      // EventSource cancellation triggers the request's AbortSignal cleanup.
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}
