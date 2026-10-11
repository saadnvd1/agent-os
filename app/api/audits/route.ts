import { NextResponse } from "next/server";
import { listAudits } from "@/lib/session-audit/store";

// GET /api/audits - every audit of every kind, newest first (the list only;
// the reports stay on this machine, outside any repo)
export async function GET() {
  return NextResponse.json({ audits: listAudits() });
}
