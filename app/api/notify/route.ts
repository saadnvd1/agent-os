import { NextRequest, NextResponse } from "next/server";
import { db, type Session } from "@/lib/db";
import { NotConfigured, sendPhone } from "@/lib/notify";

// `aos notify`: an agent pushes something to Saad's phone on purpose. Each
// sender is its own source for the once-a-minute limit.
export async function POST(request: NextRequest) {
  try {
    const { from = null, text } = await request.json();
    const session = from
      ? (db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(String(from)) as
          | Session
          | undefined)
      : undefined;
    if (from && !session) throw new Error("Unknown sender session");
    const body = String(text ?? "").trim();
    if (!body) throw new Error("Nothing to send");
    const outcome = await sendPhone(
      session ? `session:${session.id}` : "cli",
      session ? `${session.name}: ${body}` : body
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
