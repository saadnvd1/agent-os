/**
 * Creating a session, which happens on a draft's first send: the row at once,
 * then (for a worktree) the setup in the background, then the first message.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { db, queries, type Session } from "../db";
import type { AgentType } from "../providers";
import type { ChatAccess, ChatImage } from "../chat/events";
import { resolveModelForAgent } from "../model-catalog";
import { getProject } from "../projects";
import { getHost, isRemoteHost } from "../hosts";
import { hostLink } from "../hosts/remote-api";
import { startOnPeer } from "../hosts/peer-actions";
import { supportsChat } from "../chat/capabilities";
import { enqueue, editQueued, listQueue } from "../chat/queued";
import { sendQueuedNow } from "../chat/runner";
import { isBranchName } from "../git";
import { nameFor, type Naming } from "../session-titles";
import { runInBackground } from "../async-operations";
import { worktreePathFor } from "../worktrees";
import { draftFeature } from "./branch";
import { setUpWorktree } from "./worktree-setup";

// Where a chat with no project works.
export type StartView = "chat" | "terminal";

// What a new session opens as unless asked otherwise, here or on a linked
// machine. The one default: orchestrator starts use it too.
export const DEFAULT_START_VIEW: StartView = "chat";

// A caller's explicit pick, or none (the default) for anything else.
export const startView = (v: unknown): StartView | undefined =>
  v === "chat" || v === "terminal" ? v : undefined;

export const SCRATCH_DIR = path.join(os.homedir(), ".agent-os", "scratch");

export interface LaunchInput {
  projectId?: string | null;
  workingDirectory?: string | null;
  agentType: AgentType;
  model?: string | null;
  // What a chat may do without asking; "full" also starts a terminal
  // agent with its own skip-permissions flag.
  access?: ChatAccess;
  autoApprove?: boolean;
  // A scratch chat's machine. A project's sessions run where it lives.
  hostId?: string | null;
  useWorktree?: boolean;
  baseBranch?: string | null;
  // The first message.
  prompt?: string | null;
  images?: ChatImage[];
  name?: string | null;
  view?: "chat" | "terminal";
  parentSessionId?: string | null;
  groupPath?: string;
  systemPrompt?: string | null;
}

export interface Launched {
  session: Session;
  // For a terminal session, the prompt it starts with.
  initialPrompt?: string;
}

const expand = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());

function nextSessionName(): string {
  const n = (queries.getAllSessions(db).all() as Session[])
    .map((s) => Number(s.name.match(/^Session (\d+)$/)?.[1] ?? 0))
    .reduce((a, b) => Math.max(a, b), 0);
  return `Session ${n + 1}`;
}

// The project's standing prompt goes first.
function firstMessage(projectPrompt: string | null | undefined, text: string) {
  return [projectPrompt?.trim(), text.trim()].filter(Boolean).join("\n\n");
}

// Waits in the queue, so neither a restart nor a slow setup loses it.
function queueFirst(sessionId: string, text: string, images?: ChatImage[]) {
  const id = `user-${Date.now()}-${randomUUID().slice(0, 5)}`;
  enqueue(sessionId, { id, text, images });
  return id;
}

async function deliver(sessionId: string, id: string, note = "") {
  if (note) {
    const queued = listQueue(sessionId).find((m) => m.id === id);
    if (queued) editQueued(sessionId, id, queued.text + note);
  }
  await sendQueuedNow(sessionId, id);
}

export async function launchSession(input: LaunchInput): Promise<Launched> {
  const project = input.projectId ? getProject(input.projectId) : undefined;
  const scratch = !project || project.is_uncategorized;
  const hostId = (scratch && input.hostId) || project?.host_id || "local";
  if (!getHost(hostId)) throw new Error(`Unknown machine: ${hostId}`);
  const remote = isRemoteHost(hostId);
  const useWorktree = !!input.useWorktree && !scratch;
  if (useWorktree && remote)
    throw new Error("Worktrees are not available on other machines yet");
  if (input.baseBranch && !isBranchName(input.baseBranch))
    throw new Error(`"${input.baseBranch}" isn't a branch name`);

  let folder =
    input.workingDirectory?.trim() || project?.working_directory || "~";
  if (scratch) folder = remote ? "~" : folder === "~" ? SCRATCH_DIR : folder;
  // A linked machine's AgentOS starts it there; it is mirrored here.
  const link = remote ? hostLink(hostId) : null;
  if (link) {
    if (input.images?.length)
      throw new Error(`Images can't be sent to ${link.hostName} yet`);
    return startOnPeer(link, {
      project: scratch ? null : (project ?? null),
      folder,
      agentType: input.agentType,
      model: input.model,
      access: input.access,
      name: input.name,
      prompt: input.prompt?.trim(),
      view: input.view ?? DEFAULT_START_VIEW,
    });
  }
  const projectPath = expand(folder);
  if (scratch && projectPath === SCRATCH_DIR)
    await fs.promises.mkdir(SCRATCH_DIR, { recursive: true });

  const id = randomUUID();
  const agentType = input.agentType;
  const model = resolveModelForAgent(
    agentType,
    input.model?.trim() || project?.default_model
  );
  const view =
    input.view === "terminal" || !supportsChat(agentType) || remote
      ? "terminal"
      : DEFAULT_START_VIEW;
  const text = input.prompt?.trim() ?? "";
  const naming: Naming = text
    ? await nameFor(text, projectPath, input.name)
    : {
        name: input.name?.trim() || nextSessionName(),
        source: input.name?.trim() ? "user" : "default",
      };
  const cwd = useWorktree
    ? worktreePathFor(projectPath, draftFeature(id))
    : folder;

  queries
    .createSession(db)
    .run(
      id,
      naming.name,
      `${agentType}-${id}`,
      cwd,
      input.parentSessionId ?? null,
      model,
      input.systemPrompt ?? null,
      input.groupPath ?? "sessions",
      agentType,
      input.autoApprove || input.access === "full" ? 1 : 0,
      project?.id ?? "uncategorized",
      hostId
    );
  db.prepare(
    `UPDATE sessions SET view = ?, name_source = ?, setup_status = ? WHERE id = ?`
  ).run(view, naming.source, useWorktree ? "running" : null, id);
  if (input.access)
    db.prepare(`UPDATE sessions SET chat_access = ? WHERE id = ?`).run(
      input.access,
      id
    );
  const title = naming.refine
    ? naming.refine(id).then(() => sessionName(id))
    : Promise.resolve(text ? naming.name : null);

  const message =
    text || input.images?.length
      ? firstMessage(project?.initial_prompt, text)
      : "";
  const chatFirst =
    view === "chat" && message
      ? queueFirst(id, message, input.images)
      : undefined;

  if (useWorktree) {
    runInBackground(
      () =>
        setUpWorktree({
          sessionId: id,
          projectPath,
          baseBranch: input.baseBranch || null,
          title,
          onReady: async (note) => {
            if (chatFirst) await deliver(id, chatFirst, note);
          },
        }),
      `setup-session-${id}`
    );
  } else if (chatFirst) {
    runInBackground(() => deliver(id, chatFirst), `first-message-${id}`);
  }

  const session = queries.getSession(db).get(id) as Session;
  return view === "terminal" && message
    ? { session, initialPrompt: message }
    : { session };
}

function sessionName(id: string): string | null {
  const row = db.prepare(`SELECT name FROM sessions WHERE id = ?`).get(id) as
    | { name: string }
    | undefined;
  return row?.name ?? null;
}
