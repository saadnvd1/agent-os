import { NextRequest, NextResponse } from "next/server";
import { resolveSession } from "@/lib/bus";
import { getDoneTarget } from "@/lib/done";
import { inScope, scopeOf } from "@/lib/done/bulk";
import { getHost, hostIdNamed } from "@/lib/hosts";
import { moveTask } from "@/lib/tasks";

// `aos move <session> <machine>`: carry a task on on a linked machine, or
// bring it back ("here"). From inside a session it reaches only that
// session's workspace (or project), as aos done does.
export async function POST(request: NextRequest) {
  try {
    const { from = null, session, machine } = await request.json();
    const target = resolveSession(String(session ?? ""));
    if (typeof from === "string" && from) {
      const caller = getDoneTarget(from);
      const scope = scopeOf(caller);
      if (!inScope(scope, target))
        throw new Error(
          `${target.name} isn't in ${caller.name}'s ${"workspaceId" in scope ? "workspace" : "project"}; aos move reaches only those`
        );
    }
    const hostId = hostIdNamed(String(machine ?? ""));
    const moved = await moveTask(target.id, hostId);
    const where = getHost(moved.host_id)?.name ?? "the other machine";
    return NextResponse.json({
      session: moved,
      summary: `${target.name} is now running on ${moved.host_id === "local" ? "this machine" : where}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
