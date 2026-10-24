import { NextRequest, NextResponse } from "next/server";
import { db, type Session } from "@/lib/db";
import { switchSessionModelRef } from "@/lib/models/session-model";

// POST /api/sessions/:id/model {ref} - move a running session to another
// model ("provider/model", or "pi/<provider>/<model>" for a Pi session),
// keeping its conversation.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { ref } = (await request.json().catch(() => ({}))) as { ref?: unknown };
  const session = db
    .prepare(`SELECT * FROM session_rows WHERE id = ?`)
    .get(id) as Session | undefined;
  if (!session)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (typeof ref !== "string" || !ref.trim())
    return NextResponse.json({ error: "ref is required" }, { status: 400 });
  try {
    await switchSessionModelRef(session, ref);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
