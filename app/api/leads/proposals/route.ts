import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import { getWorkspace } from "@/lib/workspaces";
import { isLeadKind } from "@/lib/leads/roles";
import { openProposals } from "@/lib/leads/direction";
import { confirmPins } from "@/lib/leads/adopt";

const bad = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });

// A lead's pins waiting for the owner.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const workspaceId = q.get("workspaceId") ?? "";
  const kind = q.get("kind") ?? "";
  if (!getWorkspace(workspaceId)) return bad("Unknown workspace", 404);
  if (!isLeadKind(kind)) return bad("Unknown lead");
  return NextResponse.json({ proposals: openProposals(workspaceId, kind) });
}

// The owner's one tap: the confirmed proposals become pinned direction, the
// rest are dropped, and with switchOver the lead starts fresh on its memo
// and direction (an adopted lead's switch).
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const { workspaceId, kind, confirm, switchOver } = body;
  if (typeof workspaceId !== "string" || !getWorkspace(workspaceId))
    return bad("Unknown workspace", 404);
  if (!isLeadKind(kind)) return bad("Unknown lead");
  if (
    !Array.isArray(confirm) ||
    !confirm.every((n) => Number.isInteger(n) && n > 0)
  )
    return bad("confirm is a list of proposal ids");
  try {
    return NextResponse.json(
      await confirmPins({
        workspaceId,
        kind,
        confirm,
        switchOver: switchOver === true,
      })
    );
  } catch (error) {
    return bad(error instanceof Error ? error.message : String(error));
  }
}
