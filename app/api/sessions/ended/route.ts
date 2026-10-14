import { NextRequest, NextResponse } from "next/server";
import { endedSessions, type EndedKind } from "@/lib/resurrect/find";

const KINDS = new Set(["dropped", "done", "archived"]);

// GET /api/sessions/ended[?workspace=id][&kind=dropped|done|archived][&limit=n]
// - what can be restored, most recently ended first.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const workspace = q.get("workspace");
  const kind = q.get("kind");
  const limit = Math.min(Math.max(Number(q.get("limit")) || 50, 1), 200);
  return NextResponse.json({
    sessions: endedSessions(workspace ? { workspaceId: workspace } : null, {
      limit,
      kind: kind && KINDS.has(kind) ? (kind as EndedKind) : undefined,
    }),
  });
}
