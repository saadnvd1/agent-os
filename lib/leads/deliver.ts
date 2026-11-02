import { sendChat } from "../chat/runner";
import { AGENTOS_SENDER } from "../orchestrator/deliver";
import { getLead } from "./home";
import type { LeadKind } from "./types";

// A line from AgentOS to a lead other than Tech, which has no event queue
// of its own: it arrives as the lead's next prompt, after any turn running.
export async function tellLead(
  workspaceId: string,
  kind: LeadKind,
  text: string,
  id?: string
): Promise<boolean> {
  const lead = getLead(workspaceId, kind);
  if (!lead) return false;
  await sendChat(lead.id, {
    text,
    id,
    queue: true,
    from: AGENTOS_SENDER,
    origin: { kind: "event", label: "AgentOS" },
  });
  return true;
}
