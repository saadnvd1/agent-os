import { NextRequest, NextResponse } from "next/server";
import { markMoved } from "@/lib/tasks/move";
import { refuse } from "@/lib/tasks/contract/authorize";
import { cleanUpMovedAway } from "@/lib/tasks/moved-away";
import { runInBackground } from "@/lib/async-operations";

// POST /api/tasks/:id/moved - the task now runs on the machine named `to`
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const refused = refuse(request, id, "open");
  if (refused) return refused;
  const { to } = await request.json().catch(() => ({}));
  markMoved(id, String(to || "another machine").slice(0, 100));
  // A task its orchestrator took back: its agent and worktree here go.
  runInBackground(async () => {
    await cleanUpMovedAway(id);
  }, `moved-away-${id}`);
  return NextResponse.json({ success: true });
}
