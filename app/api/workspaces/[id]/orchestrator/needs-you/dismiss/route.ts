import { NextRequest, NextResponse } from "next/server";
import { dismissItem, undismissItem } from "@/lib/orchestrator/questions";

type RouteParams = { params: Promise<{ id: string }> };

const KEY = /^(ask|question|task|approval):[\w:.-]{1,100}$/;

async function keyOf(request: NextRequest): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as {
    key?: unknown;
  } | null;
  return typeof body?.key === "string" && KEY.test(body.key) ? body.key : null;
}

// Hides an item from the Needs-you strip. It resolves nothing: an ask stays
// open on its list and in the counts.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const key = await keyOf(request);
  if (!key) return NextResponse.json({ error: "Bad key" }, { status: 400 });
  dismissItem(id, key);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const key = await keyOf(request);
  if (!key) return NextResponse.json({ error: "Bad key" }, { status: 400 });
  undismissItem(id, key);
  return NextResponse.json({ ok: true });
}
