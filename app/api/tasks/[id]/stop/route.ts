import { NextRequest } from "next/server";
import { stopSession } from "@/lib/sessions/stop";
import { heldRoute } from "@/lib/tasks/held-routes";

// POST /api/tasks/:id/stop - its orchestrator stops the agent; the
// conversation and worktree are kept.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return heldRoute(request, ctx, async (task) => ({
    text: await stopSession(task),
  }));
}
