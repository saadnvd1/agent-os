import { NextRequest, NextResponse } from "next/server";
import { markMoved } from "@/lib/tasks/move";
import { callingDevice } from "@/lib/security/device-me";
import { heldRefusal } from "@/lib/tasks/held";
import { cleanUpMovedAway } from "@/lib/tasks/moved-away";
import { runInBackground } from "@/lib/async-operations";

// POST /api/tasks/:id/moved - the task now runs on the machine named `to`
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const held = heldRefusal(id, callingDevice(request));
  if (held) return NextResponse.json({ error: held }, { status: 403 });
  const { to } = await request.json().catch(() => ({}));
  markMoved(id, String(to || "another machine").slice(0, 100));
  // A task its orchestrator took back: its agent and worktree here go.
  if (held === null)
    runInBackground(async () => {
      await cleanUpMovedAway(id);
    }, `moved-away-${id}`);
  return NextResponse.json({ success: true });
}
