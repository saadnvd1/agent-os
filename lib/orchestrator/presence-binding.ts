// The string a passkey challenge is bound to, per purpose. An ask's binds
// its id and what it's about now, so an approval can't be replayed on a
// later commit, another brake, or another ask.

import { askBinding, getAsk } from "./asks";
import { PresenceError, type PresencePurpose } from "../security/presence";

export const askPresence = (askId: number, binding: string) =>
  `ask:${askId}:${binding}`;
export const resumePresence = (workspaceId: string) => `resume:${workspaceId}`;
export const revokePresence = (passkeyId: string) => `revoke:${passkeyId}`;
export const APPROVALS_OFF_PRESENCE = "approvals-off";

export function presenceBinding(b: {
  purpose?: PresencePurpose;
  workspaceId?: string;
  askId?: number;
  binding?: string;
  passkeyId?: string;
}): string {
  switch (b.purpose) {
    case "approve": {
      const ask = getAsk(b.workspaceId ?? "", Number(b.askId));
      if (!ask || ask.status !== "open")
        throw new PresenceError("That ask isn't open any more");
      if (b.binding !== askBinding(ask))
        throw new PresenceError(
          "This ask changed since you saw it; look again"
        );
      return askPresence(ask.id, b.binding);
    }
    case "resume":
      if (!b.workspaceId) throw new PresenceError("Which workspace?");
      return resumePresence(b.workspaceId);
    case "enroll":
      return "enroll";
    case "approvals-off":
      return APPROVALS_OFF_PRESENCE;
    case "revoke":
      if (!b.passkeyId) throw new PresenceError("Which passkey?");
      return revokePresence(b.passkeyId);
    default:
      throw new PresenceError("Unknown purpose");
  }
}
