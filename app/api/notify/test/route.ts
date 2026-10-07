import { NextResponse } from "next/server";
import { NotConfigured, sendPhone } from "@/lib/notify";

export async function POST() {
  try {
    const outcome = await sendPhone("settings-test", "Test from AgentOS");
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
