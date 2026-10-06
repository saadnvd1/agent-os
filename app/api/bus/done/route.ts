import { NextRequest, NextResponse } from "next/server";
import { resolveSession } from "@/lib/bus";
import { doneSession, getDoneTarget } from "@/lib/done";
import { doneIdle, scopeOf } from "@/lib/done/bulk";

// `aos done <session>` and `aos done --all-idle`. from: the calling
// session, whose project or workspace --all-idle sweeps.
export async function POST(request: NextRequest) {
  try {
    const { from = null, session, allIdle = false } = await request.json();
    const callerId = typeof from === "string" ? from : null;
    if (allIdle) {
      if (!callerId) throw new Error("--all-idle needs a calling session");
      const scope = scopeOf(getDoneTarget(callerId));
      const result = await doneIdle(scope, { by: "direct", callerId });
      return NextResponse.json({ summary: result.summary, result });
    }
    const target = resolveSession(String(session ?? ""));
    const outcome = await doneSession(target.id, { by: "direct", callerId });
    return NextResponse.json({ summary: outcome.text, outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
