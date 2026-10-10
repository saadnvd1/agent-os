import { NextResponse } from "next/server";
import { doneSession } from "@/lib/done";

// POST /api/sessions/:id/done - finished work: merge through the gates if
// its PR is open, clean up, archive. 409 with the reason when refused.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const outcome = await doneSession((await params).id, {
      by: "direct",
      onPeer: true,
    });
    return NextResponse.json({ outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
