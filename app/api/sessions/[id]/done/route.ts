import { NextResponse } from "next/server";
import { doneSession, getDoneTarget } from "@/lib/done";
import { withinDeadline } from "@/lib/done/deadline";

// POST /api/sessions/:id/done - finished work: merge through the gates if
// its PR is open, clean up, archive. 409 with the reason when refused.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const outcome = await withinDeadline(
      doneSession(id, { by: "direct", onPeer: true }),
      getDoneTarget(id).name
    );
    return NextResponse.json({ outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
