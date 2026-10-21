import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loopSummary } from "@/lib/loops";

// GET /api/loops - the pill for every task that has had a loop in the last
// day, by task id.
export async function GET() {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const ids = db
    .prepare(
      `SELECT DISTINCT session_id FROM task_loops WHERE state = 'running' OR COALESCE(ended_at, 0) >= ?`
    )
    .all(since) as { session_id: string }[];
  const loops: Record<string, ReturnType<typeof loopSummary>> = {};
  for (const { session_id } of ids) loops[session_id] = loopSummary(session_id);
  return NextResponse.json({ loops });
}
