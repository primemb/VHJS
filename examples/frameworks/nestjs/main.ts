/**
 * NestJS + VHJS: provider/controller split and static HLS output.
 *
 * Copy this into a NestJS app and install the packages listed in ../README.md.
 */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { BadRequestException, Body, Controller, Injectable, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createVhjs } from "@primemb/vhjs";

const hlsRoot = resolve(process.cwd(), "hls-output");

@Injectable()
class TranscodesService {
  private readonly client = createVhjs();

  async start(input: string): Promise<{ id: string; playlistUrl: string }> {
    const id = randomUUID();
    const job = this.client.startTranscodeToHls({ input, outputDir: resolve(hlsRoot, id) });
    void job.result.catch(() => undefined);
    return { id, playlistUrl: `/hls/${id}/master.m3u8` };
  }
}

@Controller("transcodes")
class TranscodesController {
  constructor(private readonly transcodes: TranscodesService) {}

  @Post()
  async create(@Body("input") input: unknown): Promise<{ id: string; playlistUrl: string }> {
    if (typeof input !== "string" || input.length === 0) {
      throw new BadRequestException("input must be a non-empty server-side path");
    }
    return this.transcodes.start(input);
  }
}

@Module({ controllers: [TranscodesController], providers: [TranscodesService] })
class AppModule {}

await mkdir(hlsRoot, { recursive: true });
const app = await NestFactory.create(AppModule);
app.useStaticAssets(hlsRoot, { prefix: "/hls/" });
await app.listen(3000);
