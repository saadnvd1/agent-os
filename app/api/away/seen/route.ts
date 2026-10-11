import { NextRequest, NextResponse } from "next/server";
import { markReportSeen } from "@/lib/away/state";

// POST /api/away/seen - { id }: dismiss that "While you were away" report.
// It stays in Settings > Audits.
export async function POST(request: NextRequest) {
  const { id } = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof id !== "number" || !Number.isInteger(id))
    return NextResponse.json({ error: "id must be a number" }, { status: 400 });
  markReportSeen(id);
  return NextResponse.json({ ok: true });
}
