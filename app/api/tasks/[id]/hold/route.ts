import { NextRequest, NextResponse } from "next/server";
import { callingDevice } from "@/lib/security/device-me";
import { holdExisting } from "@/lib/tasks/held";
import { validateOrchestrated } from "@/lib/tasks/move-bundle";

// POST /api/tasks/:id/hold - the paired device whose orchestrator started a
// task here asks to hold it, as a move would have: for a queue-placed task
// started before holding existed. It never starts a task.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const id = (await ctx.params).id;
  const device = callingDevice(request);
  if (!device)
    return NextResponse.json(
      { error: "An orchestrator's task comes only from a paired machine" },
      { status: 403 }
    );
  try {
    const { orchestrated } = await request.json();
    const held = holdExisting(id, device, validateOrchestrated(orchestrated));
    return NextResponse.json({ held }, { status: held ? 200 : 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
