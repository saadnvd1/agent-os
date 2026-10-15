import { NextRequest } from "next/server";
import { blockedReason } from "@/lib/tasks/state";
import { saidSinceLastMessage } from "@/lib/chat/store";
import { chatStateNow } from "@/lib/chat/runner";
import { taskRoute } from "@/lib/tasks/contract/authorize";

// GET /api/tasks/:id/chat-facts - what its chat says about being blocked
// and whether a question is open, for the orchestrator that moved it here.
// Cheap (no PR lookups), unlike the whole task list.
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return taskRoute(request, ctx, "holder", async (task) => {
    if (task.view !== "chat") return { blocked: null, turn: null };
    return {
      blocked: blockedReason(saidSinceLastMessage(task.id)),
      turn: await chatStateNow(task.id).catch(() => "unknown"),
    };
  });
}
