import type { ChatDriver } from "../driver";
import { CHAT_AGENT_TYPES } from "../capabilities";
import { claudeDriver } from "./claude";
import { codexDriver } from "./codex";
import { openCodeDriver } from "./opencode";
import { piDriver } from "./pi";
import { copilotDriver } from "./copilot";
import { demoDriver } from "./demo";
import { demoChatMode, demoMode } from "../../security/demo";

// One driver per agent CLI. Adding a CLI means a driver here and its agent
// type in CHAT_AGENT_TYPES.
const DRIVERS: Record<(typeof CHAT_AGENT_TYPES)[number], ChatDriver> = {
  claude: claudeDriver,
  codex: codexDriver,
  pi: piDriver,
  opencode: openCodeDriver,
  copilot: copilotDriver,
};

export function chatDriverFor(agentType: string): ChatDriver | null {
  const driver = DRIVERS[agentType as keyof typeof DRIVERS] ?? null;
  // A demo never starts a real agent (lib/chat/demo runs this one).
  return driver && (demoMode() || demoChatMode()) ? demoDriver : driver;
}
