import { NextRequest, NextResponse } from "next/server";
import {
  applyCard,
  CardRefused,
  dismissCard,
} from "@/lib/learning-cards/apply";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cardId = Number(id);
  if (!Number.isInteger(cardId) || cardId < 1)
    return NextResponse.json({ error: "Bad card id" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  try {
    if (body.action === "dismiss")
      return NextResponse.json({ card: dismissCard(cardId) });
    if (body.action !== "apply")
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    const card = await applyCard(cardId, {
      lesson: text(body.lesson),
      brief: text(body.brief),
      taskPrompt: text(body.taskPrompt),
    });
    return NextResponse.json({ card });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed";
    return NextResponse.json(
      { error: message },
      { status: error instanceof CardRefused ? 409 : 400 }
    );
  }
}
