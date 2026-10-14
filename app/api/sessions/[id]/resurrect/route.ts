import { NextRequest, NextResponse } from "next/server";
import { resurrectSession } from "@/lib/resurrect";
import { callingDevice } from "@/lib/security/device-me";
import { db, queries, type Session } from "@/lib/db";

// POST /api/sessions/:id/resurrect - bring a dropped, done or archived
// session back: same id, same conversation, its status as it was. A refusal
// (merged PR, conversation gone, project removed) is a 409 with the reason.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const outcome = await resurrectSession(id, {
      device: callingDevice(request),
    });
    const session = queries.getSession(db).get(id) as Session | undefined;
    return NextResponse.json({ outcome, session });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
