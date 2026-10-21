import { NextRequest } from "next/server";
import { stopByUser } from "@/lib/loops";
import { loopRoute } from "@/lib/loops/route";

// POST /api/tasks/:id/loop/stop - end the loop; the coder's turn, if one
// is running, is left alone.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return loopRoute(request, ctx, {}, (task) => ({ view: stopByUser(task.id) }));
}
