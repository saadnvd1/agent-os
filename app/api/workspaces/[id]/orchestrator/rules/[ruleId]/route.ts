import { NextRequest, NextResponse } from "next/server";
import { removeRule, updateRule } from "@/lib/orchestrator/rules";
import { requireApprover } from "@/lib/security/approver";

type RouteParams = { params: Promise<{ id: string; ruleId: string }> };

async function target(request: NextRequest, { params }: RouteParams) {
  const gate = requireApprover(request);
  if (!gate.ok) return { response: gate.response };
  const { id, ruleId } = await params;
  const n = Number(ruleId);
  if (!Number.isInteger(n) || n <= 0)
    return {
      response: NextResponse.json({ error: "Bad rule id" }, { status: 400 }),
    };
  return { workspaceId: id, ruleId: n };
}

const refused = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 400 }
  );

// { text }: Saad rewords a rule.
export async function PATCH(request: NextRequest, ctx: RouteParams) {
  const t = await target(request, ctx);
  if ("response" in t) return t.response;
  const { text } = (await request.json().catch(() => ({}))) as {
    text?: unknown;
  };
  if (typeof text !== "string")
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  try {
    return NextResponse.json({
      rule: updateRule(t.workspaceId, t.ruleId, text),
    });
  } catch (error) {
    return refused(error);
  }
}

// Marked removed, never deleted.
export async function DELETE(request: NextRequest, ctx: RouteParams) {
  const t = await target(request, ctx);
  if ("response" in t) return t.response;
  try {
    removeRule(t.workspaceId, t.ruleId, "saad");
    return NextResponse.json({ success: true });
  } catch (error) {
    return refused(error);
  }
}
