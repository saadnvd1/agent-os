import { readFile } from "fs/promises";
import { NextRequest } from "next/server";
import { loopLogPath } from "@/lib/loops/gatherEvidence";
import { latestLoopFor } from "@/lib/loops/store";
import { loopRoute } from "@/lib/loops/route";
import { LoopError } from "@/lib/loops/types";
import { redact } from "@/lib/models/secrets";

const MAX = 64 * 1024;

// GET /api/tasks/:id/loop/cycles/:n/log - the tail of that cycle's checks
// output, redacted and capped.
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; n: string }> }
) {
  const n = Number((await ctx.params).n);
  return loopRoute(request, ctx, {}, async (task) => {
    if (!latestLoopFor(task.id) || !Number.isInteger(n) || n < 1)
      throw new LoopError("No such cycle", 404);
    let text = "";
    try {
      text = await readFile(loopLogPath(task.id, n), "utf8");
    } catch {
      throw new LoopError("No log for that cycle", 404);
    }
    return { log: redact(text.length > MAX ? text.slice(-MAX) : text) };
  });
}
