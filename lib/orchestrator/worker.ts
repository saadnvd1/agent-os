import type { Session } from "../db";
import { agentEnv } from "../agents/launch";
import { loadOrchestratorBrief } from "./brief";
import { orchestratorToken } from "./home";
import { ORCHESTRATOR_SERVER } from "./tool-names";
import { orchestratorPermissions } from "./mcp-servers";
import { getWorkspace } from "../workspaces";
import {
  httpToolCaller,
  orchestratorTools,
  orchestratorToolsDigest,
} from "./tools";
import type { RoleExtras } from "../chat/worker/extras";
import { refreshSettings } from "../chat/refresh";
import { orchestratorFullAccess } from "./full-access";
import { orchestratorToolRefusal } from "./write-guard";

// What an orchestrator's chat worker starts with on top of any chat: its
// brief, its tools, permissions fixed by its role, and the guard on where
// it may write.
export async function orchestratorExtras(
  session: Session
): Promise<RoleExtras> {
  const baseUrl = agentEnv(session.id).AGENTOS_URL;
  const permissions = orchestratorPermissions(
    getWorkspace(session.workspace_id ?? "")?.orch_mcp_servers ?? [],
    orchestratorFullAccess(session)
  );
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
    ...permissions,
    toolGuard: (tool, input) => orchestratorToolRefusal(session, tool, input),
    toolsDigest: orchestratorToolsDigest(permissions),
    refresh: {
      atTokens: refreshSettings().orchestratorTokens,
      role: "orchestrator",
    },
  };
}
