import { NextResponse } from "next/server";
import { doneSession, getDoneTarget } from "@/lib/done";
import { withinDeadline } from "@/lib/done/deadline";

// Sessions with a done running. Released when the work ends, not when the
// request's deadline does, so a retry can't start a parallel run beside one
// that is still going.
const g = globalThis as unknown as { __agentosDoneRunning?: Set<string> };
const running: Set<string> = (g.__agentosDoneRunning ??= new Set());

// POST /api/sessions/:id/done - finished work: merge through the gates if
// its PR is open, clean up, archive. 404 for an unknown session, 409 with
// the reason when refused or already running.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  let name: string;
  try {
    name = getDoneTarget(id).name;
  } catch {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (running.has(id))
    return NextResponse.json(
      { error: `${name} is already being finished: wait for it to end.` },
      { status: 409 }
    );
  running.add(id);
  try {
    const work = doneSession(id, { by: "direct", onPeer: true });
    work.then(
      () => running.delete(id),
      () => running.delete(id)
    );
    const outcome = await withinDeadline(work, name);
    return NextResponse.json({ outcome });
  } catch (error) {
    // A done that threw before it started has nothing left to hold.
    if (!(error instanceof Error) || !/taking longer/.test(error.message))
      running.delete(id);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
