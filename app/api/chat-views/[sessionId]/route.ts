import { NextResponse } from "next/server";
import { readViewBody } from "@/lib/chat-views/body";
import { saveChatView } from "@/lib/chat-views/store";

type Ctx = { params: Promise<{ sessionId: string }> };

// Ids are uuids today; anything id-shaped fits other machines' sessions too.
const ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

// PUT /api/chat-views/:sessionId { itemId, offsetPx, atEnd } - the reader is
// here in this chat; or { viewed: true } - they just opened it.
export async function PUT(request: Request, { params }: Ctx) {
  const { sessionId } = await params;
  if (!ID_SHAPE.test(sessionId))
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const body = await readViewBody(request);
  if (body instanceof NextResponse) return body;
  return NextResponse.json({ view: saveChatView(sessionId, body.input) });
}
