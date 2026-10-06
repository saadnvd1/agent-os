import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { requireApprover } from "@/lib/security/approver";
import { relyingParty, verifyPresence } from "@/lib/security/presence";
import { refusalResponse } from "@/lib/security/presence-http";
import {
  answerAsk,
  getAsk,
  PRESENCE_KINDS,
  type AskAnswer,
} from "@/lib/orchestrator/asks";
import { askPresence } from "@/lib/orchestrator/presence-binding";

type RouteParams = { params: Promise<{ id: string; askId: string }> };

function parseAnswer(body: unknown): AskAnswer | null {
  const b = (body ?? {}) as { action?: unknown; text?: unknown };
  if (b.action === "approve" || b.action === "decline")
    return { action: b.action };
  if (b.action === "reply" && typeof b.text === "string")
    return { action: "reply", text: b.text };
  return null;
}

// Saad answers an ask. Only a trusted place may (this machine, the tailnet,
// a device he let approve), and approving a hard line, a gate, a brake or a
// passkey also needs his passkey on a challenge bound to this ask as it is.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  const { id, askId } = await params;
  const body = (await request.json().catch(() => null)) as {
    binding?: string;
    assertion?: AuthenticationResponseJSON;
  } | null;
  const answer = parseAnswer(body);
  if (!answer)
    return NextResponse.json(
      { error: "Send approve, decline, or reply with text" },
      { status: 400 }
    );
  try {
    const ask = getAsk(id, Number(askId));
    if (!ask)
      return NextResponse.json({ error: "No such ask" }, { status: 404 });
    if (answer.action === "approve") {
      if (typeof body?.binding !== "string")
        return NextResponse.json(
          { error: "Approve must say what it approves" },
          { status: 400 }
        );
      if (PRESENCE_KINDS.includes(ask.kind))
        await verifyPresence(
          relyingParty(request.headers),
          body.assertion,
          "approve",
          askPresence(ask.id, body.binding)
        );
    }
    return NextResponse.json({
      ask: answerAsk(id, ask.id, answer, body?.binding),
    });
  } catch (error) {
    return refusalResponse(error);
  }
}
