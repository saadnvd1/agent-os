/**
 * Drafts: a new session before its first send. ⌥N opens one in a composer;
 * the session, its worktree and its agent are made only when it's sent.
 */

import type { AgentType } from "./providers";
import type { ChatAccess } from "./chat/events";
import { resolveModelForAgent } from "./model-catalog";
import { projectsInWorkspace } from "./sidebar/shelves";

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
  // A task that runs in a terminal rather than a chat (the default).
  terminal?: boolean;
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

// The draft ⌥N opens for a project: its empty one if it has one (typed ones
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

// What the sidebar has selected: a workspace and a project filter in it.
export interface DraftScope {
  workspaceId: string | null;
  projectId: string | null;
}

// The project ⌥N (or the sidebar's New) starts in: the one you're in, else
// the sidebar's project filter in the selected workspace, else the most
// recently used, else the first.
// With a workspace selected only its projects count, so a session viewed or
// used last in another workspace doesn't pull the draft out of it.
export function currentProjectId(
  viewing: { projectId: string | null } | null,
  recent: { project_id: string | null; updated_at: string }[],
  projects: {
    id: string;
    is_uncategorized: boolean;
    workspace_id?: string | null;
  }[],
  scope: DraftScope = { workspaceId: null, projectId: null }
): string | null {
  const here = projectsInWorkspace(projects, scope.workspaceId);
  const real = (id: string | null | undefined) =>
    !!id && here.some((p) => p.id === id && !p.is_uncategorized);
  if (viewing && real(viewing.projectId)) return viewing.projectId;
  // Only inside a selected workspace; "All workspaces" skips the filter.
  if (scope.workspaceId && real(scope.projectId)) return scope.projectId;
  const latest = [...recent]
    .filter((s) => real(s.project_id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return latest?.project_id ?? here.find((p) => real(p.id))?.id ?? null;
}

// The projects "In project…" offers: the selected workspace's real ones, or
// every real one when none is selected.
export function pickableProjects<
  P extends { is_uncategorized: boolean; workspace_id?: string | null },
>(projects: P[], workspaceId: string | null): P[] {
  return projectsInWorkspace(projects, workspaceId).filter(
    (p) => !p.is_uncategorized
  );
}

export type DraftKey = "current" | "choose" | "scratch";

// ⌥N: the current project. ⌥⇧N: pick one. ⌃⌥N: a scratch chat. Browsers keep
// ⌘N, ⌘⇧N and ⌘⌥N for their own windows and never pass them to the page, so
// those only work where they arrive (an installed app); ⌥ works in a tab too.
// `mod` is ⌘ on a Mac and Ctrl elsewhere. Read by code, since ⌥ changes the
// key's character.
export function draftKeyFor(e: {
  code: string;
  mod: boolean;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey?: boolean;
}): DraftKey | null {
  if (e.code !== "KeyN") return null;
  if (e.mod) {
    if (e.altKey && e.shiftKey) return null;
    if (e.altKey) return "scratch";
    return e.shiftKey ? "choose" : "current";
  }
  if (!e.altKey) return null;
  if (e.ctrlKey) return e.shiftKey ? null : "scratch";
  return e.shiftKey ? "choose" : "current";
}

// The keys shown in the app for each kind of draft.
export const DRAFT_KEYS: Record<DraftKey, string> = {
  current: "⌥N",
  choose: "⌥⇧N",
  scratch: "⌃⌥N",
};

/**
 * A draft for a project here, kept for a machine that can no longer take
 * it: gone from the machines it may use, or refusing with a reason. Never
 * before both lists have loaded, and never for a task or this machine.
 */
export function draftHostGone(
  draft: Pick<Draft, "hostId" | "openPr">,
  projectHere: boolean,
  machines: { id: string }[] | null,
  reasons: Record<string, string | null> | null
): boolean {
  if (!machines || !projectHere || draft.openPr || draft.hostId === "local")
    return false;
  if (!machines.some((h) => h.id === draft.hostId)) return true;
  return !!reasons && reasons[draft.hostId] != null;
}
