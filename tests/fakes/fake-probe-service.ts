import type { ProbeService } from "../../src/ports/index.js";
import type { SourceMetadata } from "../../src/types/metadata.js";

/**
 * A `ProbeService` that returns preset metadata and records the inputs it was
 * asked about — so validation/use-case tests never spawn ffprobe.
 */
export class FakeProbeService implements ProbeService {
  readonly inputs: string[] = [];

  constructor(private readonly metadata: SourceMetadata) {}

  async probe(input: string): Promise<SourceMetadata> {
    this.inputs.push(input);
    return this.metadata;
  }
}
