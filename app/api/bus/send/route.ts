import { NextRequest, NextResponse } from "next/server";
import { sendMessage } from "@/lib/bus";

// from: the sending session's id, or null when the user sends from the UI.
// The message is stored either way; delivery says whether it reached the
// recipient ("delivered", "queued" behind a busy turn, or "failed" + why).
export async function POST(request: NextRequest) {
  try {
    const { from = null, to, body } = await request.json();
    const sent = await sendMessage({
      fromId: from,
      to: String(to ?? ""),
      body: String(body ?? ""),
    });
    return NextResponse.json(sent, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
