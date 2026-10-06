import type { ChatDriver } from "../driver";
import { CHAT_AGENT_TYPES } from "../capabilities";
import { claudeDriver } from "./claude";

// One driver per agent CLI. Adding a CLI means a driver here and its agent
// type in CHAT_AGENT_TYPES.
const DRIVERS: Record<(typeof CHAT_AGENT_TYPES)[number], ChatDriver> = {
  claude: claudeDriver,
};

export function chatDriverFor(agentType: string): ChatDriver | null {
  return DRIVERS[agentType as keyof typeof DRIVERS] ?? null;
}
