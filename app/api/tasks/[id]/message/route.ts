import { NextRequest } from "next/server";
import { statusDetector } from "@/lib/status-detector";
import { deliver } from "@/lib/bus";
import { sendChatConfirmed } from "@/lib/chat/runner";
import { cleanRemoteText } from "@/lib/hosts/remote-api";
import { taskRoute } from "@/lib/tasks/contract/authorize";

const MAX_LINE = 40_000;

// POST /api/tasks/:id/message {id?, line, from} - the orchestrator that moved
// this task here speaks to it. It arrives as that orchestrator's message,
// never as the user's, and a repeat of the same id is not delivered twice.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const body = await request.json().catch(() => ({}));
  return taskRoute(request, ctx, "holder", async (task) => {
    const line = typeof body.line === "string" ? body.line.trim() : "";
    if (!line || line.length > MAX_LINE) throw new Error("Bad message");
    const id = typeof body.id === "string" ? body.id.slice(0, 100) : undefined;
    const from = cleanRemoteText(body.from).slice(0, 100) || "the orchestrator";
    const label = `${from} on ${task.held_from ?? "another machine"}`;
    if (task.view === "chat") {
      const state = await sendChatConfirmed(task.id, {
        id,
        text: line,
        from: label,
        origin: { kind: "peer", label },
        compact: "auto",
      });
      return { state };
    }
    await statusDetector.refreshCache();
    const delivery = await deliver(task, line, { name: label });
    if (delivery.state === "failed") throw new Error(delivery.why);
    return { state: delivery.state };
  });
}
