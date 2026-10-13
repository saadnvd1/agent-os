import { NextRequest } from "next/server";
import { chatTailText } from "@/lib/orchestrator/read";
import { heldRoute } from "@/lib/tasks/held-routes";

// GET /api/tasks/:id/chat-tail?lines= - the last lines of its conversation,
// for the orchestrator that moved it here to read.
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const lines = Number(request.nextUrl.searchParams.get("lines")) || 60;
  return heldRoute(request, ctx, async (task) => ({
    text: task.view === "chat" ? chatTailText(task.id, lines) : "",
  }));
}
