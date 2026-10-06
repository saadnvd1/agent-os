import { NextRequest, NextResponse } from "next/server";
import { listArchived } from "@/lib/done/archive";

// GET /api/sessions/archived[?workspace=id] - done sessions, newest first.
export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace");
  return NextResponse.json({ sessions: listArchived(workspace || undefined) });
}
