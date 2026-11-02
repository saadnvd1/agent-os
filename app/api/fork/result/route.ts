import { NextRequest, NextResponse } from "next/server";
import { fail, text } from "@/lib/fork/api";
import { findChild, markUsed, numberOf } from "@/lib/fork/ledger";

// One child's whole result (`aos children <n>`); reading it counts as
// opening it, for the stats.
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const parent = text(params.get("session"));
    const ref = text(params.get("ref"));
    if (!parent || !ref) throw new Error("session and ref are required");
    const c = findChild(parent, ref);
    markUsed(c.child_session_id, "opened");
    return NextResponse.json({
      id: c.child_session_id,
      n: numberOf(parent, c.child_session_id),
      label: c.label,
      state: c.state,
      outcome: c.outcome,
      kind: c.result_kind,
      summary: c.summary,
      result: c.result,
      instruction: c.instruction,
    });
  } catch (error) {
    return fail(error);
  }
}
