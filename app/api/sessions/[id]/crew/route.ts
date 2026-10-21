import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { crewMembers } from "@/lib/sessions/crew";
import { modelCatalog } from "@/lib/models/catalog";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/sessions/:id/crew - the session's role and the sessions it works
// with (same crew), each with its model and whether that is local or cloud.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const row = db
    .prepare(`SELECT agent_role, crew_id FROM session_rows WHERE id = ?`)
    .get(id) as
    { agent_role: string | null; crew_id: string | null } | undefined;
  if (!row)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const choices = new Map(modelCatalog().map((c) => [c.ref, c]));
  const members = row.crew_id
    ? crewMembers(row.crew_id).map((m) => {
        const ref = m.model
          ? `${m.agentType === "pi" ? "pi" : (m.modelProvider ?? "anthropic")}/${m.model}`
          : null;
        const choice = ref ? choices.get(ref) : undefined;
        return {
          ...m,
          ref,
          locality: choice?.locality ?? "cloud",
          availability: choice?.availability.state ?? "unknown",
        };
      })
    : [];
  return NextResponse.json({
    agentRole: row.agent_role,
    crewId: row.crew_id,
    members,
  });
}
