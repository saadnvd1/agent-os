import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { removeRule, updateRule } from "@/lib/orchestrator/rules";
import { provenAsSaad } from "../presence";

type RouteParams = { params: Promise<{ id: string; ruleId: string }> };

type Body = { text?: unknown; assertion?: AuthenticationResponseJSON };

// The rule, its body, and Saad's passkey on it; or the refusal.
async function target(
  request: NextRequest,
  { params }: RouteParams
): Promise<
  { response: Response } | { workspaceId: string; ruleId: number; body: Body }
> {
  const { id, ruleId } = await params;
  const n = Number(ruleId);
  if (!Number.isInteger(n) || n <= 0)
    return {
      response: NextResponse.json({ error: "Bad rule id" }, { status: 400 }),
    };
  const body = (await request.json().catch(() => ({}))) as Body;
  const refused = await provenAsSaad(request, id, body.assertion);
  if (refused) return { response: refused };
  return { workspaceId: id, ruleId: n, body };
}

const refused = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 400 }
  );

// { text, assertion }: Saad rewords a rule.
export async function PATCH(request: NextRequest, ctx: RouteParams) {
  const t = await target(request, ctx);
  if ("response" in t) return t.response;
  if (typeof t.body.text !== "string")
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  try {
    return NextResponse.json({
      rule: updateRule(t.workspaceId, t.ruleId, t.body.text),
    });
  } catch (error) {
    return refused(error);
  }
}

// { assertion }: marked removed, never deleted.
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
