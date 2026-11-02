import { NextRequest, NextResponse } from "next/server";
import { experimentOn } from "@/lib/experiments";
import { requireApprover } from "@/lib/security/approver";
import { getWorkspace } from "@/lib/workspaces";
import { sessionById } from "@/lib/bus/targets";
import { sessionWorkspace } from "@/lib/schedules/store";
import { workspaceLeads, workspacesWithLeads } from "@/lib/leads/settings";
import { addLeads, leadViews } from "@/lib/leads/home";

const view = (workspaceId: string) => {
  const w = workspaceLeads(workspaceId)!;
  return {
    workspaceId,
    workspace: getWorkspace(workspaceId)?.name ?? "?",
    chiefAutonomy: w.chiefAutonomy,
    leads: leadViews(workspaceId),
  };
};

// The workspaces with leads, and each one's leads. With `from` (a session),
// only that session's workspace, unless `all`.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const from = sessionById(q.get("from"));
  const own = from && !q.has("all") ? sessionWorkspace(from) : null;
  const workspaces = workspacesWithLeads()
    .filter((w) => !own || w.workspaceId === own)
    .map((w) => view(w.workspaceId));
  return NextResponse.json({
    enabled: experimentOn("leads"),
    workspace: own,
    workspaces,
  });
}

// "Add leads" on a workspace: its Tech lead (its orchestrator) and the
// leads picked. Safe to repeat.
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  if (!experimentOn("leads"))
    return NextResponse.json(
      { error: "Leads is off (Settings → Experiments)" },
      { status: 409 }
    );
  const body = await request.json().catch(() => ({}));
  const workspaceId =
    typeof body.workspaceId === "string" ? body.workspaceId : "";
  if (!getWorkspace(workspaceId))
    return NextResponse.json({ error: "Unknown workspace" }, { status: 404 });
  try {
    addLeads(workspaceId, body.kinds ?? []);
    return NextResponse.json(view(workspaceId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
