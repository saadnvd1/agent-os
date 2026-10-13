import { NextRequest, NextResponse } from "next/server";
import { resolveQuestion } from "@/lib/orchestrator/questions";

type RouteParams = { params: Promise<{ id: string; questionId: string }> };

// Saad answered a question the orchestrator put to him in chat.
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id, questionId } = await params;
  const n = Number(questionId);
  if (!Number.isInteger(n) || n < 1)
    return NextResponse.json({ error: "Not a question" }, { status: 400 });
  if (!resolveQuestion(id, n, "saad"))
    return NextResponse.json({ error: "Not open" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
