import type { Session } from "../db";
import { agentEnv } from "../agents/launch";
import { loadOrchestratorBrief } from "./brief";
import { orchestratorToken } from "./home";
import { ORCHESTRATOR_PERMISSIONS, ORCHESTRATOR_SERVER } from "./tool-names";
import {
  httpToolCaller,
  orchestratorTools,
  orchestratorToolsDigest,
} from "./tools";
import type { RoleExtras } from "../chat/worker/extras";

// What an orchestrator's chat worker starts with on top of any chat: its
// brief, its tools, and permissions fixed by its role.
export async function orchestratorExtras(
  session: Session
): Promise<RoleExtras> {
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
    toolsDigest: orchestratorToolsDigest(),
  };
}
