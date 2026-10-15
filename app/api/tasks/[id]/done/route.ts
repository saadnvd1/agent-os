import { NextRequest } from "next/server";
import { doneSession } from "@/lib/done";
import { taskRoute } from "@/lib/tasks/contract/authorize";

// POST /api/tasks/:id/done - its orchestrator finishes it: the agent stops
// and the worktree goes. Never a merge (noMerge): an open PR is refused
// here, since only its orchestrator's gates merge it.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return taskRoute(request, ctx, "holder", async (task) => ({
    outcome: await doneSession(task.id, { by: "direct", noMerge: true }),
  }));
}
