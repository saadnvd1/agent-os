import { NextRequest, NextResponse } from "next/server";
import { isFinished } from "@/lib/tasks/state";
import { latestByTask, summaryOf } from "@/lib/reports/store";

// GET /api/workspaces/:id/reports - the newest report of each task: headline,
// estimate and state. ?active=1 leaves out finished tasks.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const active = request.nextUrl.searchParams.get("active") === "1";
  const reports = latestByTask(id)
    .filter(({ report }) => !active || !isFinished(report.state))
    .map(({ report, name }) => summaryOf(report, name));
  return NextResponse.json({ reports });
}
