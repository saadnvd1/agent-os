import { NextRequest, NextResponse } from "next/server";
import { resolveSession } from "@/lib/bus";
import { doneSession, getDoneTarget } from "@/lib/done";
import { doneIdle, inScope, scopeOf } from "@/lib/done/bulk";

// `aos done <session>` and `aos done --all-idle`, from inside a session:
// both reach only the caller's workspace (or its project when it has
// none). --all-idle never merges.
export async function POST(request: NextRequest) {
  try {
    const { from = null, session, allIdle = false } = await request.json();
    if (typeof from !== "string" || !from)
      throw new Error("aos done runs from inside an AgentOS session");
    const caller = getDoneTarget(from);
    const scope = scopeOf(caller);
    if (allIdle) {
      const result = await doneIdle(scope, { by: "direct", callerId: from });
      return NextResponse.json({ summary: result.summary, result });
    }
    const target = resolveSession(String(session ?? ""));
    if (!inScope(scope, target))
      throw new Error(
        `${target.name} isn't in ${caller.name}'s ${"workspaceId" in scope ? "workspace" : "project"}; aos done reaches only those`
      );
    const outcome = await doneSession(target.id, {
      by: "direct",
      callerId: from,
    });
    return NextResponse.json({ summary: outcome.text, outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
