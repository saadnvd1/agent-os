/**
 * Drafts: a new session before its first send. ⌘N opens one in a composer;
 * the session, its worktree and its agent are made only when it's sent.
 */

import type { AgentType } from "./providers";
import type { ChatAccess } from "./chat/events";
import { resolveModelForAgent } from "./model-catalog";

export interface Draft {
  id: string;
  // null: a scratch chat, in no project.
  projectId: string | null;
  hostId: string;
  agentType: AgentType;
  model: string;
  access: ChatAccess;
  useWorktree: boolean;
  // null: the project's default branch.
  baseBranch: string | null;
  // A task: works alone and opens a pull request when done.
  openPr: boolean;
  createdAt: number;
}

// What a new draft takes from the session being viewed.
export interface Carry {
  agentType?: AgentType;
  model?: string;
  access?: ChatAccess;
}

export interface DraftProject {
  id: string;
  agent_type: AgentType;
  default_model: string;
  host_id: string;
  is_uncategorized: boolean;
}

export const draftComposerKey = (draftId: string) => `draft-${draftId}`;

// A real project's own agent and model win; a scratch chat keeps what you
// were using. Access carries either way.
export function newDraft(
  id: string,
  project: DraftProject | null,
  carry: Carry,
  opts: { openPr?: boolean; now?: number } = {}
): Draft {
  const real = project && !project.is_uncategorized ? project : null;
  const agentType = real?.agent_type ?? carry.agentType ?? "claude";
  return {
    id,
    projectId: real?.id ?? null,
    hostId: real?.host_id || "local",
    agentType,
    model: resolveModelForAgent(
      agentType,
      real ? real.default_model : carry.model
    ),
    access: carry.access ?? "edits",
    useWorktree: !!real && (real.host_id || "local") === "local",
    baseBranch: null,
    openPr: !!opts.openPr,
    createdAt: opts.now ?? Date.now(),
  };
}

// The draft ⌘N opens for a project: its empty one if it has one (typed ones
// are kept, reachable from the sidebar), else none and a new one is made.
export function reusableDraft(
  drafts: Draft[],
  projectId: string | null,
  hasText: (draftId: string) => boolean,
  openPr = false
): Draft | null {
  return (
    drafts.find(
      (d) => d.projectId === projectId && d.openPr === openPr && !hasText(d.id)
    ) ?? null
  );
}

// The project ⌘N starts in: the one you're in, else the most recently used.
export function currentProjectId(
  viewing: { projectId: string | null } | null,
  recent: { project_id: string | null; updated_at: string }[],
  projects: { id: string; is_uncategorized: boolean }[]
): string | null {
  const real = (id: string | null | undefined) =>
    !!id && projects.some((p) => p.id === id && !p.is_uncategorized);
  if (viewing && real(viewing.projectId)) return viewing.projectId;
  const latest = [...recent]
    .filter((s) => real(s.project_id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return latest?.project_id ?? projects.find((p) => real(p.id))?.id ?? null;
}

export type DraftKey = "current" | "choose" | "scratch";

// ⌘N: the current project. ⌘⇧N: pick one. ⌘⌥N: a scratch chat. `mod` is
// ⌘ on a Mac and Ctrl elsewhere. Read by code, since ⌥ changes the key's
// character.
export function draftKeyFor(e: {
  code: string;
  mod: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): DraftKey | null {
  if (e.code !== "KeyN" || !e.mod) return null;
  if (e.altKey && e.shiftKey) return null;
  if (e.altKey) return "scratch";
  return e.shiftKey ? "choose" : "current";
}
