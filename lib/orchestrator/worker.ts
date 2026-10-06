import type { Session } from "../db";
import type { ChatStartOptions } from "../chat/driver";
import { agentEnv } from "../agents/launch";
import { loadOrchestratorBrief } from "./brief";
import { ORCHESTRATOR_SERVER } from "./tool-names";
import { httpToolCaller, ORCHESTRATOR_TOOLS, orchestratorTools } from "./tools";

// What an orchestrator's chat worker starts with on top of any chat: its
// brief and its tools, which it may use without asking.
export async function orchestratorExtras(
  session: Session
): Promise<
  Pick<ChatStartOptions, "systemAppend" | "mcpServers" | "allowedTools">
> {
  const baseUrl = agentEnv(session.id).AGENTOS_URL;
  return {
    systemAppend: await loadOrchestratorBrief(session),
    mcpServers: {
      [ORCHESTRATOR_SERVER]: orchestratorTools(
        httpToolCaller(baseUrl, session.workspace_id ?? "")
      ),
    },
    allowedTools: ORCHESTRATOR_TOOLS,
  };
}
