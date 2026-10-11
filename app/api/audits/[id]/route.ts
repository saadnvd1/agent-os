import { NextRequest, NextResponse } from "next/server";
import { AUDIT_ID, readReport } from "@/lib/session-audit/store";

type Params = { params: Promise<{ id: string }> };

// GET /api/audits/<id> - one audit's report, as markdown
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!AUDIT_ID.test(id))
    return NextResponse.json({ error: "Bad audit id" }, { status: 400 });
  const markdown = readReport(id);
  if (markdown === null)
    return NextResponse.json({ error: "No such audit" }, { status: 404 });
  return NextResponse.json({ id, markdown });
}
