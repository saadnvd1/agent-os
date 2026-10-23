/**
 * What the start form needs in one request: the agents and their models, the
 * models a task can run on, the machines, the default branch and whether a
 * task plans first. Built from the helpers the web form already uses; never
 * a provider's address or key reference, nor a machine's ssh target.
 */

import { AGENT_OPTIONS } from "./agent-options";
import { getProviderDefinition } from "./providers/registry";
import { probeAgents } from "./agents/probe";
import { gitCheck } from "./git";
import { listHosts } from "./hosts";
import { hostCatalog } from "./machines/remote";
import { projectMachines } from "./hosts/project-machines";
import { getModelOptions, getDefaultModelForAgent } from "./model-catalog";
import { effectiveModels } from "./models/config";
import { modelChoices } from "./models/choices";
import { resolveRole } from "./models/resolve";
import { getProject } from "./projects";
import { expandHome } from "./tasks/session";
import { taskRouting } from "./tasks";
import type { StartOptions } from "./tasks/loop-types";

const BRANCHES_MAX = 50;

export class UnknownProjectError extends Error {}

export async function startOptions(
  projectId: string | null
): Promise<StartOptions> {
  const project = projectId ? getProject(projectId) : undefined;
  if (projectId && (!project || project.is_uncategorized))
    throw new UnknownProjectError("Project not found");
  const here = !project || (project.host_id || "local") === "local";
  const models = effectiveModels();

  let planDefault = false;
  let planError: string | null = null;
  const roles = { plan: "", implement: "" };
  try {
    const opts = { workspaceId: project?.workspace_id ?? null };
    roles.plan = resolveRole("plan", opts, models).ref;
    roles.implement = resolveRole("implement", opts, models).ref;
    planDefault = taskRouting(
      opts.workspaceId,
      "chat",
      undefined,
      undefined,
      undefined,
      project?.tier
    ).plan;
  } catch (error) {
    planError = error instanceof Error ? error.message : String(error);
  }

  // A project on another machine shows that machine's agents, as it reports them.
  const there = here
    ? null
    : (await hostCatalog(project?.host_id ?? "")).catalog;
  const [probes, git, machines] = await Promise.all([
    here ? probeAgents() : Promise.resolve(null),
    project && here
      ? gitCheck(expandHome(project.working_directory))
      : Promise.resolve(null),
    project
      ? projectMachines(project)
      : Promise.resolve<Record<string, string | null>>({}),
  ]);

  return {
    project: project
      ? {
          id: project.id,
          name: project.name,
          agentType: project.agent_type,
          defaultModel: project.default_model,
          hostId: project.host_id || "local",
        }
      : null,
    agents: AGENT_OPTIONS.filter(
      (a) =>
        !getProviderDefinition(a.value)?.legacy || probes?.[a.value]?.installed
    ).map((a) => ({
      value: a.value,
      label: a.label,
      installed:
        probes?.[a.value]?.installed ??
        there?.agents.find((t) => t.agent === a.value)?.installed ??
        null,
      auth:
        probes?.[a.value]?.auth ??
        there?.agents.find((t) => t.agent === a.value)?.auth ??
        null,
      hint:
        probes?.[a.value]?.hint ??
        there?.agents.find((t) => t.agent === a.value)?.hint ??
        null,
      models:
        there?.agents.find((t) => t.agent === a.value)?.models ??
        getModelOptions(a.value),
      defaultModel: getDefaultModelForAgent(a.value),
    })),
    taskModels: modelChoices(models),
    roles,
    planDefault,
    planError,
    hosts: listHosts().map((h) => ({
      id: h.id,
      name: h.name,
      linked: h.id === "local" || Boolean(h.linked),
      unavailable: machines[h.id] ?? null,
    })),
    git: git && {
      isGitRepo: git.isGitRepo,
      defaultBranch: git.defaultBranch,
      currentBranch: git.currentBranch,
      branches: git.branches.slice(0, BRANCHES_MAX),
    },
  };
}
