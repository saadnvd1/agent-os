import { NextRequest } from "next/server";
import { stopSession } from "@/lib/sessions/stop";
import { taskRoute } from "@/lib/tasks/contract/authorize";

// POST /api/tasks/:id/stop - its orchestrator stops the agent; the
// conversation and worktree are kept.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return taskRoute(request, ctx, "holder", async (task) => ({
    text: await stopSession(task),
  }));
}
