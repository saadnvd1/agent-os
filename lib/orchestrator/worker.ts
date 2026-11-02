import type { Session } from "../db";
import { agentEnv } from "../agents/launch";
import { loadOrchestratorBrief } from "./brief";
import { ORCHESTRATOR_SERVER } from "./tool-names";
import { orchestratorPermissions } from "./mcp-servers";
import { getWorkspace } from "../workspaces";
import {
  httpToolCaller,
  orchestratorTools,
  orchestratorToolsDigest,
  type ExtraTool,
} from "./tools";
import type { RoleExtras } from "../chat/worker/extras";
import { refreshSettings } from "../chat/refresh";
import { orchestratorFullAccess } from "./full-access";
import { orchestratorToolRefusal } from "./write-guard";
import { hasLeads } from "../leads/settings";
import { profileFor, type Profile } from "../leads/profiles";
import { standingToken } from "../leads/home";
import { LEAD_TOOL_DESCRIPTIONS, LEAD_TOOL_SHAPES } from "../leads/tools";
import { loadLeadBrief, techLeadAdditions } from "../leads/brief";
import { loadChiefBrief } from "../leads/chief";
import { CHIEF } from "../leads/order";

const leadTools = (p: Profile): ExtraTool[] =>
  p.leadTools.map((name) => ({
    name,
    description: LEAD_TOOL_DESCRIPTIONS[name],
    shape: LEAD_TOOL_SHAPES[name],
  }));

// What a standing chat's worker (the orchestrator, a lead, the chief)
// starts with on top of any chat: its brief, the tools its profile gives it
// (lib/leads/profiles), permissions fixed by its role, and the guard on
// where it may write. The orchestrator of a workspace without leads gets exactly what it always had.
export async function orchestratorExtras(
  session: Session
): Promise<RoleExtras> {
  const workspaceId = session.workspace_id ?? "";
  const leads = hasLeads(workspaceId);
  const profile = profileFor(session, leads);
  if (!profile) throw new Error("This session has no tool profile yet");
  const tech = profile.kind === "tech";
  const chief = profile.kind === CHIEF;
  const extra = leadTools(profile);
  const baseUrl = agentEnv(session.id).AGENTOS_URL;
  const base = orchestratorPermissions(
    getWorkspace(workspaceId)?.orch_mcp_servers ?? [],
    orchestratorFullAccess(session)
  );
  const permissions = extra.length
    ? {
        ...base,
        allowedTools: [
          ...base.allowedTools,
          ...extra.map((t) => `mcp__${ORCHESTRATOR_SERVER}__${t.name}`),
        ],
      }
    : base;
  const names = tech ? undefined : profile.tools;
  return {
    systemAppend: tech
      ? await loadOrchestratorBrief(
          session,
          leads ? techLeadAdditions(session) : undefined
        )
      : chief
        ? await loadChiefBrief(session, profile)
        : await loadLeadBrief(session, profile),
    mcpServers: {
      [ORCHESTRATOR_SERVER]: orchestratorTools(
        httpToolCaller(baseUrl, workspaceId, standingToken(session.id)),
        profile.tools,
        extra
      ),
    },
    ...permissions,
    toolGuard: (tool, input) => orchestratorToolRefusal(session, tool, input),
    toolsDigest: orchestratorToolsDigest(permissions, names, extra),
    refresh: {
      atTokens: refreshSettings().orchestratorTokens,
      role: "orchestrator",
    },
  };
}
