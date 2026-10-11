import { NextRequest, NextResponse } from "next/server";
import { AUDIT_NAME, readAuditReport } from "@/lib/session-audit/store";

type Params = { params: Promise<{ kind: string; id: string }> };

// GET /api/audits/<kind>/<id> - one audit's report, as markdown
export async function GET(_request: NextRequest, { params }: Params) {
  const { kind, id } = await params;
  if (!AUDIT_NAME.test(kind) || !AUDIT_NAME.test(id))
    return NextResponse.json({ error: "Bad audit id" }, { status: 400 });
  const markdown = readAuditReport(kind, id);
  if (markdown === null)
    return NextResponse.json({ error: "No such audit" }, { status: 404 });
  return NextResponse.json({ kind, id, markdown });
}
