import { NextResponse } from "next/server";
import { startTranscode } from "../../../../lib/vhjs-jobs.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => undefined);
  const input =
    typeof body === "object" && body !== null && "input" in body ? body.input : undefined;
  if (typeof input !== "string" || input.length === 0) {
    return NextResponse.json(
      { error: "input must be a non-empty server-side path" },
      { status: 400 },
    );
  }
  return NextResponse.json(await startTranscode(input), { status: 202 });
}
