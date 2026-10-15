import { NextRequest } from "next/server";
import { chatTailText } from "@/lib/orchestrator/read";
import { taskRoute } from "@/lib/tasks/contract/authorize";

// GET /api/tasks/:id/chat-tail?lines= - the last lines of its conversation,
// for the orchestrator that moved it here to read.
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const lines = Number(request.nextUrl.searchParams.get("lines")) || 60;
  return taskRoute(request, ctx, "holder", async (task) => ({
    text: task.view === "chat" ? chatTailText(task.id, lines) : "",
  }));
}
