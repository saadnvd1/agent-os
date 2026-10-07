// Agent types that can run as chat. Safe to import from the browser: the
// drivers themselves (and their SDKs) live in lib/chat/drivers.
export const CHAT_AGENT_TYPES = ["claude", "codex"] as const;

export function supportsChat(agentType: string | null | undefined): boolean {
  return (
    !!agentType && (CHAT_AGENT_TYPES as readonly string[]).includes(agentType)
  );
}
