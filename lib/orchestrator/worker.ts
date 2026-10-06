import type { Session } from "../db";
import type { ChatStartOptions } from "../chat/driver";
import { agentEnv } from "../agents/launch";
import { loadOrchestratorBrief } from "./brief";
import { orchestratorToken } from "./home";
import { ORCHESTRATOR_PERMISSIONS, ORCHESTRATOR_SERVER } from "./tool-names";
import { httpToolCaller, orchestratorTools } from "./tools";

// What an orchestrator's chat worker starts with on top of any chat: its
// brief, its tools, and permissions fixed by its role.
export async function orchestratorExtras(
  session: Session
): Promise<
  Pick<
    ChatStartOptions,
    | "systemAppend"
    | "mcpServers"
    | "allowedTools"
    | "disallowedTools"
    | "permissionMode"
  >
> {
  const baseUrl = agentEnv(session.id).AGENTOS_URL;
  return {
    systemAppend: await loadOrchestratorBrief(session),
    mcpServers: {
      [ORCHESTRATOR_SERVER]: orchestratorTools(
        httpToolCaller(
          baseUrl,
          session.workspace_id ?? "",
          orchestratorToken(session.workspace_id ?? "")
        )
      ),
    },
    ...ORCHESTRATOR_PERMISSIONS,
  };
}
