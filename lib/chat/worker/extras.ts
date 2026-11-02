import type { Session } from "../../db";
import type { ChatStartOptions } from "../driver";
import { refreshSettings } from "../refresh";
import { sessionProviderEnv } from "../../models/launch";
import { childExtras } from "../../fork/extras";

export type RoleExtras = Pick<
  ChatStartOptions,
  | "systemAppend"
  | "mcpServers"
  | "allowedTools"
  | "disallowedTools"
  | "permissionMode"
  | "toolGuard"
> & {
  // A digest of the tools AgentOS gives this role (an orchestrator's): the
  // worker after a deploy tells the agent only when it changed.
  toolsDigest?: string;
  // Start over on a new conversation once its context passes this many
  // tokens (lib/chat/refresh); absent or 0, never.
  refresh?: { atTokens: number; role: "orchestrator" | "task" };
  // What the session's model provider needs in the agent's environment
  // (lib/models), its key fetched just now. Held by this process only.
  env?: Record<string, string>;
};

// What a session's role adds to its chat. An orchestrator's module loads
// only for one; a task's chat gets its brief, as its terminal agent would.
export async function roleExtras(session: Session): Promise<RoleExtras> {
  const [extras, env] = await Promise.all([
    ownExtras(session),
    sessionProviderEnv(session),
  ]);
  const fork = childExtras(session);
  return {
    ...extras,
    ...(fork?.toolGuard && { toolGuard: fork.toolGuard }),
    ...((env || fork) && { env: { ...env, ...fork?.env } }),
  };
}

async function ownExtras(session: Session): Promise<RoleExtras> {
  if (session.role === "orchestrator")
    return (await import("../../orchestrator/worker")).orchestratorExtras(
      session
    );
  // A role's brief (and an analyst's) is the session's own system prompt.
  const own = session.system_prompt?.trim();
  if (!session.task_brief) return own ? { systemAppend: own } : {};
  const atTokens =
    session.task_status === "running" ? refreshSettings().taskTokens : 0;
  return {
    systemAppend: [session.task_brief, own].filter(Boolean).join("\n\n"),
    ...(atTokens > 0 && { refresh: { atTokens, role: "task" as const } }),
  };
}
