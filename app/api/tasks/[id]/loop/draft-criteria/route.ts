import { NextRequest } from "next/server";
import { draftCriteria } from "@/lib/loops";
import { loopRoute } from "@/lib/loops/route";
import { LoopError } from "@/lib/loops/types";

// POST /api/tasks/:id/loop/draft-criteria - a drafted checklist from the
// card or the task's text; nothing is saved.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return loopRoute(request, ctx, {}, async (task) => {
    if (!task.worktree_path)
      throw new LoopError("The task has no worktree", 409);
    return { criteria: await draftCriteria(task, task.worktree_path) };
  });
}
