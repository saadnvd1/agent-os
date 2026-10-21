import { NextRequest, NextResponse } from "next/server";
import { db, type Session } from "@/lib/db";
import { setChatModel } from "@/lib/chat/settings";
import { providerFor, sessionRole } from "@/lib/models/resolve";
import { switchSessionModel } from "@/lib/models/session-model";
import { PI } from "@/lib/models/providers";
import { formatModelRef, parseModelRef } from "@/lib/models/roles";

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
    const parsed = parseModelRef(ref);
    if (session.agent_type === "pi") {
      if (parsed.provider !== PI)
        throw new Error(
          "A Pi session runs on a Pi model (pi/<provider>/<model>)"
        );
      await setChatModel(id, parsed.model);
    } else {
      if (parsed.provider === PI)
        throw new Error("Only a Pi session can move to a Pi model");
      await switchSessionModel(id, {
        role: sessionRole(session),
        ref: formatModelRef(parsed),
        provider: providerFor(parsed.provider),
        model: parsed.model,
        source: "task",
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
