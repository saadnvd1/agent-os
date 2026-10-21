import { NextRequest, NextResponse } from "next/server";
import { refuse } from "@/lib/tasks/contract/authorize";
import { latestReport } from "@/lib/reports/store";

// GET /api/tasks/:id/report/evidence/:evId - one piece of evidence behind the
// latest report, for the drill-down. Its text is untrusted: show it only.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; evId: string }> }
) {
  const { id, evId } = await params;
  const refused = refuse(request, id, "open");
  if (refused) return refused;
  const ev = latestReport(id)?.evidence.find((e) => e.id === evId);
  if (!ev)
    return NextResponse.json({ error: "No such evidence" }, { status: 404 });
  return NextResponse.json({ evidence: ev });
}
