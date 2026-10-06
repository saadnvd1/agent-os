// Every new passkey goes on Saad's asks list in each workspace with an
// orchestrator, so one he didn't make can't go unseen. Decline revokes it.

import type { PasskeyRow } from "../security/passkeys";
import { AskRefused, passkeySubject, raiseAsk } from "./asks";
import { listOrchestrators } from "./home";

export function raisePasskeyAsks(key: PasskeyRow, place: string): number {
  const at = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  let n = 0;
  for (const o of listOrchestrators()) {
    if (!o.workspace_id) continue;
    try {
      raiseAsk({
        workspaceId: o.workspace_id,
        subject: passkeySubject(key.id),
        kind: "passkey",
        title: `New passkey registered on ${place} at ${at}`,
        detail: `"${key.name}" for ${key.rp_id}. If this wasn't you, Decline to revoke it.`,
      });
      n++;
    } catch (error) {
      if (!(error instanceof AskRefused)) throw error;
    }
  }
  return n;
}
