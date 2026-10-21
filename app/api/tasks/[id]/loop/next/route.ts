import { NextRequest } from "next/server";
import { z } from "zod";
import { actOnNext } from "@/lib/loops";
import { loopRoute } from "@/lib/loops/route";

const schema = z.object({
  action: z.enum(["send", "hold", "skip"]),
  instruction: z.string().max(8000).optional(),
});

// POST /api/tasks/:id/loop/next - what to do with the instruction in its
// countdown: send it (edited or not), hold the countdown, or skip the cycle.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return loopRoute(request, ctx, { schema }, async (task, body) => ({
    view: await actOnNext(
      task.id,
      body.action === "send"
        ? { action: "send", instruction: body.instruction }
        : { action: body.action }
    ),
  }));
}
