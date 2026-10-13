import { NextResponse } from "next/server";
import { reopenSession, settleSession } from "@/lib/sidebar/shelf-state";

// POST /api/sessions/:id/settle { settled } - Mark done (true) or Reopen
// (false). Not an archive: new activity brings a settled session back.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    settled?: unknown;
  } | null;
  if (typeof body?.settled !== "boolean")
    return NextResponse.json(
      { error: "settled must be a boolean" },
      { status: 400 }
    );
  if (!(body.settled ? settleSession(id) : reopenSession(id)))
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
