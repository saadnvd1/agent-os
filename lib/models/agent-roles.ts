/**
 * The roles a person assigns models to: Developer, Analyst, Reviewer and
 * Supervisor. Each binds one of the model roles in ./roles, so there is one
 * routing system: Developer is `implement`, Supervisor is `orchestrator`,
 * and Analyst and Reviewer have a model role of their own. Imported by the
 * browser too, so no Node modules here.
 */

import type { ModelRole } from "./roles";

export const AGENT_ROLES = [
  "developer",
  "analyst",
  "reviewer",
  "supervisor",
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export interface AgentRoleDef {
  id: AgentRole;
  label: string;
  // The one line shown beside its model.
  purpose: string;
  modelRole: ModelRole;
  // Appended to the instructions of a session started in the role.
  brief: string;
  // Whether it may change files.
  edits: boolean;
}

export const AGENT_ROLE_DEFS: Record<AgentRole, AgentRoleDef> = {
  developer: {
    id: "developer",
    label: "Developer",
    purpose: "Writes the code: tasks, and sessions started as Developer",
    modelRole: "implement",
    edits: true,
    brief:
      "You are the Developer in this crew. You write and change the code. When your work is ready, tell the Reviewer with `aos send @reviewer`; answer the Analyst's questions with `aos send @analyst`.",
  },
  analyst: {
    id: "analyst",
    label: "Analyst",
    purpose:
      "Reads code, logs and the Developer's work; explains and proposes; doesn't commit",
    modelRole: "analyze",
    edits: false,
    brief:
      "You are the Analyst in this crew. You read code, logs and data, and the Developer's transcript (`aos read @developer`), then explain what you find and propose changes. You don't edit files, commit or open pull requests; send proposals to the Developer with `aos send @developer`.",
  },
  reviewer: {
    id: "reviewer",
    label: "Reviewer",
    purpose:
      "Reviews another role's diff and suggests improvements. Advice only: not the merge gate",
    modelRole: "advise",
    edits: false,
    brief:
      "You are the Reviewer in this crew. Read the Developer's diff (`git diff` in its worktree, `aos read @developer`) and send concrete suggestions with `aos send @developer`. You don't edit files or open pull requests. Your review is advice; the merge gate is separate.",
  },
  supervisor: {
    id: "supervisor",
    label: "Supervisor",
    purpose:
      "Watches a crew, sequences work, unblocks and reports. The workspace orchestrator",
    modelRole: "orchestrator",
    edits: false,
    brief:
      "You are the Supervisor in this crew. Watch the other roles (`aos peers`, `aos read @developer`), unblock them, sequence the work and report to the user. You don't write the code yourself.",
  },
};

export const isAgentRole = (v: unknown): v is AgentRole =>
  typeof v === "string" && (AGENT_ROLES as readonly string[]).includes(v);

export const agentRoleOf = (modelRole: ModelRole): AgentRole | undefined =>
  AGENT_ROLES.find((r) => AGENT_ROLE_DEFS[r].modelRole === modelRole);

// The model roles under the four above, shown as "internal" roles.
export const INTERNAL_MODEL_ROLES = (all: readonly ModelRole[]) =>
  all.filter((r) => !agentRoleOf(r));

// A session's brief for its role, or "" with none.
export function roleBrief(role: string | null | undefined): string {
  return isAgentRole(role) ? AGENT_ROLE_DEFS[role].brief : "";
}
