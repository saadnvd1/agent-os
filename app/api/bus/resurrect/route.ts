import { NextRequest, NextResponse } from "next/server";
import { getDoneTarget } from "@/lib/done";
import { scopeOf } from "@/lib/done/bulk";
import { resurrectSession } from "@/lib/resurrect";
import { endedSessions, resolveEnded } from "@/lib/resurrect/find";

// `aos resurrect [session]`, from inside a session: reaches only the
// caller's workspace (or its project when it has none). Without a session it
// lists the dropped and done ones that can come back.
export async function POST(request: NextRequest) {
  try {
    const { from = null, session } = await request.json();
    if (typeof from !== "string" || !from)
      throw new Error("aos resurrect runs from inside an AgentOS session");
    const scope = scopeOf(getDoneTarget(from));
    if (typeof session !== "string" || !session.trim()) {
      const ended = endedSessions(scope, { limit: 15 });
      return NextResponse.json({
        sessions: ended,
        summary: ended.length
          ? ended
              .map(
                (e) =>
                  `${e.id.slice(0, 8)}  ${e.kind.padEnd(8)}  ${e.projectName ? `${e.projectName}/` : ""}${e.name}`
              )
              .join("\n")
          : "Nothing dropped, done or archived to restore.",
      });
    }
    const outcome = await resurrectSession(resolveEnded(session, scope));
    return NextResponse.json({ summary: outcome.text, outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
