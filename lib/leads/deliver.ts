import type { ChatOrigin } from "../chat/events";
import { sendChat } from "../chat/runner";
import { AGENTOS_SENDER } from "../orchestrator/deliver";
import { getLead } from "./home";
import type { LeadKind } from "./types";

// A line from AgentOS into a lead's chat: it arrives as the lead's next
// prompt, after any turn running. `origin` says what the chat draws.
export async function deliverToLead(
  sessionId: string,
  text: string,
  opts: { id?: string; origin?: ChatOrigin } = {}
): Promise<void> {
  await sendChat(sessionId, {
    text,
    id: opts.id,
    queue: true,
    from: AGENTOS_SENDER,
    origin: opts.origin ?? { kind: "event", label: "AgentOS" },
  });
}

// The same, to a lead by kind; false when the workspace has no such lead.
// Tech gets its events through its own queue; this is for what isn't one.
export async function tellLead(
  workspaceId: string,
  kind: LeadKind,
  text: string,
  id?: string
): Promise<boolean> {
  const lead = getLead(workspaceId, kind);
  if (!lead) return false;
  await deliverToLead(lead.id, text, { id });
  return true;
}
