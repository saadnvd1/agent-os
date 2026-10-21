import { NextRequest } from "next/server";
import { runNow } from "@/lib/loops";
import { loopRoute } from "@/lib/loops/route";

// POST /api/tasks/:id/loop/run - a cycle at the next tick; resumes a loop
// that stopped for a reason other than done.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return loopRoute(request, ctx, {}, (task) => ({ view: runNow(task.id) }));
}
