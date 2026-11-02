import { NextRequest, NextResponse } from "next/server";
import { isChild } from "@/lib/fork/ledger";
import { releaseLease, requestLease } from "@/lib/fork/heavy-lease";

// A fork child's `aos heavy` asks for a slot here and waits its turn; any
// other session isn't queued (it only gets the advice in /api/load/heavy).
export async function POST(request: NextRequest) {
  try {
    const { session, pid, action = "request" } = await request.json();
    if (typeof session !== "string" || !Number.isInteger(pid) || pid <= 0)
      return NextResponse.json(
        { error: "session and pid are required" },
        { status: 400 }
      );
    if (!isChild(session))
      return NextResponse.json({ granted: true, ahead: 0 });
    if (action === "release") {
      releaseLease(session, pid);
      return NextResponse.json({ released: true });
    }
    return NextResponse.json(requestLease(session, pid));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
