import { NextRequest, NextResponse } from "next/server";
import { db, type Session } from "@/lib/db";
import { getSetup } from "@/lib/sessions/setup-progress";
import { taskSetupOf } from "@/lib/tasks/setup";

// GET /api/sessions/:id/setup - its worktree setup: stage by stage while it
// runs (and for a while after), else the outcome on its row.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const live = getSetup(id);
  if (live) return NextResponse.json({ setup: live });
  const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;
  if (!session)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const saved = taskSetupOf(session);
  return NextResponse.json({
    setup: saved && {
      status: saved.status,
      stages: [],
      log: [],
      branch: session.branch_name,
      error: saved.error,
      startedAt: null,
    },
  });
}
