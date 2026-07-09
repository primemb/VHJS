/**
 * A running transcode exposed through the two framework-neutral progress APIs:
 * Node's familiar `EventEmitter` and an `AsyncIterable` for `for await`.
 *
 * It bridges a callback-based `Transcoder` without changing the use case or its
 * narrow FFmpeg port. This belongs in the outer DX layer, not in `hls/`.
 */
import { EventEmitter } from "node:events";
import type { TranscodeOutcome, TranscodeRequest, Transcoder } from "../hls/transcoder.js";
import type { ProgressEvent } from "../types/progress.js";

interface ProgressSubscriber {
  readonly queue: ProgressEvent[];
  closed?: boolean;
  pending?: {
    readonly resolve: (result: IteratorResult<ProgressEvent>) => void;
    readonly reject: (reason: unknown) => void;
  };
}

type JobCompletion =
  | { readonly status: "completed" }
  | { readonly status: "failed"; readonly error: unknown };

/** A single-subscriber cursor over the job's live progress stream. */
class JobProgressIterator implements AsyncIterableIterator<ProgressEvent> {
  constructor(
    private readonly job: TranscodeJob,
    private readonly subscriber: ProgressSubscriber,
  ) {}

  next(): Promise<IteratorResult<ProgressEvent>> {
    return this.job.nextProgress(this.subscriber);
  }

  return(): Promise<IteratorResult<ProgressEvent>> {
    return this.job.unsubscribe(this.subscriber);
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<ProgressEvent> {
    return this;
  }
}

/**
 * Handle for a started job. Listen with `job.on("progress", listener)` or
 * consume with `for await (const event of job)`, then await `job.result`.
 */
export class TranscodeJob extends EventEmitter implements AsyncIterable<ProgressEvent> {
  /** Resolves/rejects with the underlying transcode outcome. */
  readonly result: Promise<TranscodeOutcome>;

  private readonly subscribers = new Set<ProgressSubscriber>();
  private completion: JobCompletion | undefined;

  constructor(
    operation: (onProgress: (event: ProgressEvent) => void) => Promise<TranscodeOutcome>,
  ) {
    super();
    this.result = Promise.resolve().then(() => operation((event) => this.publish(event)));
    void this.result.then(
      (outcome) => {
        this.finish({ status: "completed" });
        this.emit("complete", outcome);
      },
      (error: unknown) => {
        this.finish({ status: "failed", error });
        this.emit("failed", error);
      },
    );
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<ProgressEvent> {
    const subscriber: ProgressSubscriber = { queue: [] };
    if (!this.completion) {
      this.subscribers.add(subscriber);
    }
    return new JobProgressIterator(this, subscriber);
  }

  /** Deliver one parsed FFmpeg progress event to both supported surfaces. */
  private publish(event: ProgressEvent): void {
    this.emit("progress", event);
    for (const subscriber of this.subscribers) {
      const pending = subscriber.pending;
      if (pending) {
        delete subscriber.pending;
        pending.resolve({ done: false, value: event });
      } else {
        subscriber.queue.push(event);
      }
    }
  }

  /** Finish all open async iterators once the underlying job settles. */
  private finish(completion: JobCompletion): void {
    this.completion = completion;
    for (const subscriber of this.subscribers) {
      const pending = subscriber.pending;
      if (!pending) {
        continue;
      }
      delete subscriber.pending;
      if (completion.status === "failed") {
        pending.reject(completion.error);
      } else {
        pending.resolve({ done: true, value: undefined });
      }
    }
    this.subscribers.clear();
  }

  /** Get the next event for a specific `for await` consumer. */
  nextProgress(subscriber: ProgressSubscriber): Promise<IteratorResult<ProgressEvent>> {
    if (subscriber.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    const event = subscriber.queue.shift();
    if (event) {
      return Promise.resolve({ done: false, value: event });
    }
    if (this.completion?.status === "failed") {
      return Promise.reject(this.completion.error);
    }
    if (this.completion?.status === "completed") {
      return Promise.resolve({ done: true, value: undefined });
    }
    if (subscriber.pending) {
      return Promise.reject(
        new Error("Only one pending next() call is allowed per progress iterator."),
      );
    }
    return new Promise<IteratorResult<ProgressEvent>>((resolve, reject) => {
      subscriber.pending = { resolve, reject };
    });
  }

  /** Stop a consumer without stopping the FFmpeg process or other consumers. */
  unsubscribe(subscriber: ProgressSubscriber): Promise<IteratorResult<ProgressEvent>> {
    this.subscribers.delete(subscriber);
    subscriber.closed = true;
    const pending = subscriber.pending;
    delete subscriber.pending;
    pending?.resolve({ done: true, value: undefined });
    return Promise.resolve({ done: true, value: undefined });
  }
}

/** Start a job while preserving a request's existing callback, if any. */
export function startTranscodeJob(
  transcoder: Pick<Transcoder, "transcodeToHls">,
  request: TranscodeRequest,
): TranscodeJob {
  const existingProgressHandler = request.onProgress;
  return new TranscodeJob(async (publish) =>
    transcoder.transcodeToHls({
      ...request,
      onProgress(event) {
        existingProgressHandler?.(event);
        publish(event);
      },
    }),
  );
}
