import { NextRequest, NextResponse } from "next/server";
import { answerAsk, type AskAnswer } from "@/lib/orchestrator/asks";

type RouteParams = { params: Promise<{ id: string; askId: string }> };

function parseAnswer(body: unknown): AskAnswer | null {
  const b = (body ?? {}) as { action?: unknown; text?: unknown };
  if (b.action === "approve" || b.action === "decline")
    return { action: b.action };
  if (b.action === "reply" && typeof b.text === "string")
    return { action: "reply", text: b.text };
  return null;
}

// Saad answers an ask: approve, decline, or reply with text.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id, askId } = await params;
  const answer = parseAnswer(await request.json().catch(() => null));
  if (!answer)
    return NextResponse.json(
      { error: "Send approve, decline, or reply with text" },
      { status: 400 }
    );
  try {
    return NextResponse.json({ ask: answerAsk(id, Number(askId), answer) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
