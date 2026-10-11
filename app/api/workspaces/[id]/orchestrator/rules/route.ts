import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspaces";
import { addRule, listRules } from "@/lib/orchestrator/rules";
import { requireApprover } from "@/lib/security/approver";

type RouteParams = { params: Promise<{ id: string }> };

// The workspace orchestrator's standing rules, in its brief on every start.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!getWorkspace(id))
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  return NextResponse.json({ rules: listRules(id) });
}

// { text }: a rule from Saad. Only from where he can answer asks.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!getWorkspace(id))
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const { text } = (await request.json().catch(() => ({}))) as {
    text?: unknown;
  };
  if (typeof text !== "string")
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  try {
    return NextResponse.json({ rule: addRule(id, text, "saad") });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
