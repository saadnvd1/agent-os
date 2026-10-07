import { NextRequest, NextResponse } from "next/server";
import { NotConfigured, notifyFrom } from "@/lib/notify";

// `aos notify`: an agent pushes something to Saad's phone on purpose. Each
// sender is its own source for the once-a-minute limit.
export async function POST(request: NextRequest) {
  try {
    const { from = null, text } = await request.json();
    const outcome = await notifyFrom(
      from === null ? null : String(from),
      String(text ?? "")
    );
    return NextResponse.json(
      outcome.state === "failed"
        ? { ...outcome, error: `FAILED: ${outcome.why}` }
        : outcome,
      {
        status: outcome.state === "failed" ? 502 : 200,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: error instanceof NotConfigured ? 409 : 400 }
    );
  }
}
