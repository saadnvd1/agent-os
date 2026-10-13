import { NextRequest, NextResponse } from "next/server";
import { resolveSession } from "@/lib/bus";
import { getDoneTarget } from "@/lib/done";
import { archiveChecked } from "@/lib/done/archive";
import { inScope, scopeOf } from "@/lib/done/bulk";

// `aos archive <session>`, from inside a session: reaches only the caller's
// workspace (or its project when it has none).
export async function POST(request: NextRequest) {
  try {
    const { from = null, session } = await request.json();
    if (typeof from !== "string" || !from)
      throw new Error("aos archive runs from inside an AgentOS session");
    const caller = getDoneTarget(from);
    const scope = scopeOf(caller);
    const target = resolveSession(String(session ?? ""));
    if (!inScope(scope, target))
      throw new Error(
        `${target.name} isn't in ${caller.name}'s ${"workspaceId" in scope ? "workspace" : "project"}; aos archive reaches only those`
      );
    await archiveChecked(target.id);
    return NextResponse.json({ summary: `Archived: ${target.name}.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
