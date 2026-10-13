import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import {
  cancelPending,
  readRun,
  realRunDeps,
  startUpdate,
} from "@/lib/updates/run";
import { isActivePhase } from "@/lib/updates/banner";
import { updateView } from "@/lib/updates/view";

// POST /api/updates/run {when: "now" | "idle"} - start an update, or ask for
// one once nothing is working. Nothing updates unless this is called.
export async function POST(request: NextRequest) {
  const allowed = requireApprover(request);
  if (!allowed.ok) return allowed.response;
  const body = (await request.json().catch(() => null)) as {
    when?: unknown;
  } | null;
  if (body?.when !== "now" && body?.when !== "idle")
    return NextResponse.json(
      { error: 'when must be "now" or "idle".' },
      { status: 400 }
    );
  const started = await startUpdate({ when: body.when });
  if (!started.ok)
    return NextResponse.json(
      { code: started.code, error: started.error },
      { status: 409 }
    );
  return NextResponse.json(await updateView({ mayUpdate: true }), {
    status: 202,
  });
}

// DELETE /api/updates/run - cancel a requested "update when idle". A started
// update can't be stopped.
export async function DELETE(request: NextRequest) {
  const allowed = requireApprover(request);
  if (!allowed.ok) return allowed.response;
  const deps = realRunDeps();
  const run = readRun(deps);
  if (run && isActivePhase(run.phase))
    return NextResponse.json(
      { error: "The update has started and can't be stopped." },
      { status: 409 }
    );
  cancelPending(deps);
  return NextResponse.json(await updateView({ mayUpdate: true }));
}
