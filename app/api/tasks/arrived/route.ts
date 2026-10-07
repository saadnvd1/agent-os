import { NextRequest, NextResponse } from "next/server";
import { arrived } from "@/lib/tasks/import";
import { isSessionId } from "@/lib/tasks/move-bundle";

// GET /api/tasks/arrived?from=<session id> - the task a move from that
// session made here, or null: how the source tells whether a move landed.
export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from");
  if (!isSessionId(from))
    return NextResponse.json({ error: "Bad session id" }, { status: 400 });
  return NextResponse.json({ session: arrived(from) ?? null });
}
