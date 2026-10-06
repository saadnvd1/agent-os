// Every passkey added or revoked goes on Saad's asks list in each workspace
// with an orchestrator, so one he didn't make or remove can't go unseen.
// Declining a new passkey's ask revokes it.

import type { PasskeyRow } from "../security/passkeys";
import {
  AskRefused,
  passkeySubject,
  raiseAsk,
  revokedPasskeySubject,
} from "./asks";
import { listOrchestrators } from "./home";

export function raisePasskeyAsks(
  key: Pick<PasskeyRow, "id" | "name" | "rp_id">,
  place: string,
  event: "registered" | "revoked" | "reset" = "registered"
): number {
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
        ...(event === "registered"
          ? {
              subject: passkeySubject(key.id),
              title: `New passkey registered on ${place} at ${at}`,
              detail: `"${key.name}" for ${key.rp_id}. If this wasn't you, Decline (with your passkey) to revoke it.`,
            }
          : {
              subject: revokedPasskeySubject(key.id),
              title:
                event === "reset"
                  ? `All passkeys were reset on ${place} at ${at}`
                  : `Passkey revoked on ${place} at ${at}`,
              detail:
                event === "reset"
                  ? "Someone ran agent-os passkeys reset. The next passkey added is trusted on first use. If this wasn't you, check this machine."
                  : `"${key.name}" for ${key.rp_id}. If this wasn't you, check Devices.`,
            }),
        kind: "passkey",
      });
      n++;
    } catch (error) {
      if (!(error instanceof AskRefused)) throw error;
    }
  }
  return n;
}
