import { NextResponse } from "next/server";
import { readIndex } from "@/lib/session-audit/store";

// GET /api/audits - every session audit, newest first (the list only; the
// reports stay on this machine, outside any repo)
export async function GET() {
  return NextResponse.json({ audits: readIndex().reverse() });
}
