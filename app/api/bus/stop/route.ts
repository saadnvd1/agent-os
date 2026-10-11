import { NextRequest, NextResponse } from "next/server";
import { resolveSession } from "@/lib/bus";
import { getDoneTarget } from "@/lib/done";
import { inScope, scopeOf } from "@/lib/done/bulk";
import { stopSession } from "@/lib/sessions/stop";

// `aos stop <session>`, from inside a session: ends the turn in progress
// (or the terminal agent) and keeps the conversation and worktree. Reaches
// only the caller's workspace (or its project when it has none).
export async function POST(request: NextRequest) {
  try {
    const { from = null, session } = await request.json();
    if (typeof from !== "string" || !from)
      throw new Error("aos stop runs from inside an AgentOS session");
    const caller = getDoneTarget(from);
    const target = resolveSession(String(session ?? ""));
    if (!inScope(scopeOf(caller), target))
      throw new Error(
        `${target.name} isn't in ${caller.name}'s workspace or project; aos stop reaches only those`
      );
    return NextResponse.json({ summary: await stopSession(target) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
