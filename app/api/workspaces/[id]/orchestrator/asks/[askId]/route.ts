import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { requireApprover } from "@/lib/security/approver";
import { relyingParty, verifyPresence } from "@/lib/security/presence";
import { placeOf, refusalResponse } from "@/lib/security/presence-http";
import { getPasskey } from "@/lib/security/passkeys";
import { raisePasskeyAsks } from "@/lib/orchestrator/passkey-asks";
import {
  answerAsk,
  getAsk,
  PRESENCE_KINDS,
  type AskAnswer,
} from "@/lib/orchestrator/asks";
import { askPresence } from "@/lib/orchestrator/presence-binding";
import { demoMode } from "@/lib/security/demo";

const isNewPasskeyAsk = (ask: { kind: string; subject: string }) =>
  ask.kind === "passkey" && ask.subject.startsWith("passkey:");

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
  // A demo's asks are seeded and its orchestrator never runs: any visitor
  // may answer, with no passkey, and nothing acts on the answer.
  const demo = demoMode();
  const gate = demo
    ? ({ ok: true, approver: { via: "device", deviceId: null } } as const)
    : requireApprover(request);
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
    if (demo && ask.kind === "passkey")
      return NextResponse.json(
        { error: "Not available in the demo." },
        { status: 403 }
      );
    // Declining a new passkey's ask revokes it, so it needs a passkey too.
    const revokes = answer.action === "decline" && isNewPasskeyAsk(ask);
    if (answer.action === "approve" || revokes) {
      if (typeof body?.binding !== "string")
        return NextResponse.json(
          { error: "Say what you're answering" },
          { status: 400 }
        );
      if (!demo && PRESENCE_KINDS.includes(ask.kind))
        await verifyPresence(
          relyingParty(request.headers),
          body.assertion,
          "approve",
          askPresence(ask.id, body.binding)
        );
    }
    const answered = answerAsk(id, ask.id, answer, body?.binding);
    if (revokes) {
      const key = getPasskey(ask.subject.slice("passkey:".length));
      if (key)
        raisePasskeyAsks(
          key,
          placeOf(gate.approver, request.headers),
          "revoked"
        );
    }
    return NextResponse.json({ ask: answered });
  } catch (error) {
    return refusalResponse(error);
  }
}
