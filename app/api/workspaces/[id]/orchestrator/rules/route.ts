import { NextRequest, NextResponse } from "next/server";
import type { PresenceProof } from "@/lib/security/presence-http";
import { getWorkspace } from "@/lib/workspaces";
import { addRule, listRules } from "@/lib/orchestrator/rules";
import { provenAsOwner } from "./presence";

type RouteParams = { params: Promise<{ id: string }> };

// The workspace orchestrator's standing rules, in its brief on every start.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!getWorkspace(id))
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  return NextResponse.json({ rules: listRules(id) });
}

// { text, assertion }: a rule from Saad, with his passkey.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!getWorkspace(id))
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as {
    text?: unknown;
  } & PresenceProof;
  const { text } = body;
  if (typeof text !== "string")
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  const refused = await provenAsOwner(request, id, body);
  if (refused) return refused;
  try {
    return NextResponse.json({ rule: addRule(id, text, "saad") });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
