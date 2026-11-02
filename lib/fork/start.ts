/**
 * Starting forks: the ledger rows first (so a crash or a repeated request
 * never doubles them), then each child's session in the background as the
 * limits allow. A parent's first open child always starts, so a parent that
 * holds a slot never waits on its own children.
 */

import os from "os";
import { randomUUID } from "crypto";
import { db, queries, type Session } from "../db";
import type { AgentType } from "../providers";
import { launchSession } from "../sessions/launch";
import { sendChat } from "../chat/runner";
import { saveItem } from "../chat/store";
import { emit } from "../chat/registry";
import { runInBackground } from "../async-operations";
import { getProject } from "../projects";
import { limitOf, runningIn, startingIn } from "../tasks/queue-rows";
import { currentLevel, loadEnabled } from "../load/monitor";
import { childFirstMessage } from "./brief";
import { ForkError, forkConversation } from "./conversation";
import {
  childrenOf,
  getChild,
  groupByRequest,
  groupChildren,
  insertGroup,
  markFellBack,
  newGroupId,
  numberOf,
  openChildren,
  setCut,
  setState,
} from "./ledger";
import { FORK_LIMITS, FORKS_OFF, forksOn, type DeliveryMode } from "./options";
import { ensureScratch, removeFork } from "./scratch";
import { parentSnapshot } from "./snapshot";
import { createForkWorktree } from "./worktree";
import type { ChildRow } from "./types";

const expand = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());

const sessionOf = (id: string) =>
  queries.getSession(db).get(id) as Session | undefined;

export interface ForkRequest {
  parentId: string;
  // The caller's key for this call; a repeat returns the same group.
  requestId: string;
  instructions: string[];
  labels?: string[];
  worktree?: boolean;
  startedBy: "agent" | "user";
  delivery?: DeliveryMode;
}

export interface ForkStarted {
  groupId: string;
  repeat: boolean;
  children: { id: string; n: number; label: string }[];
}

// Why this session can't fork, or null.
export function refusal(parent: Session | undefined): string | null {
  if (!forksOn()) return FORKS_OFF;
  if (!parent) return "Unknown session";
  if (getChild(parent.id)) return "A fork child can't fork";
  if (parent.role === "orchestrator")
    return "An orchestrator doesn't fork: start tasks or sessions instead";
  if (parent.archived_at) return "That session is archived";
  if (parent.view !== "chat") return "Forks work from a chat session";
  if (parent.host_id && parent.host_id !== "local")
    return "Forks run on this machine only";
  return null;
}

const labelFor = (instruction: string, i: number) => {
  const words = instruction.trim().split(/\s+/).slice(0, 5).join(" ");
  return `${i + 1}. ${words.length > 40 ? `${words.slice(0, 39)}…` : words}`;
};

export function startFork(req: ForkRequest): ForkStarted {
  const parent = sessionOf(req.parentId);
  const refused = refusal(parent);
  if (refused || !parent) throw new Error(refused ?? "Unknown session");
  const again = groupByRequest(req.requestId);
  if (again)
    return {
      groupId: again.id,
      repeat: true,
      children: groupChildren(again.id).map((c) => ({
        id: c.child_session_id,
        n: numberOf(parent.id, c.child_session_id),
        label: c.label,
      })),
    };
  const texts = req.instructions.map((t) => t.trim()).filter(Boolean);
  if (!texts.length) throw new Error("Give each fork an instruction");
  if (texts.length > FORK_LIMITS.maxPerFork)
    throw new Error(`At most ${FORK_LIMITS.maxPerFork} forks at a time`);
  if (texts.some((t) => t.length > FORK_LIMITS.instructionChars))
    throw new Error(
      `An instruction is over ${FORK_LIMITS.instructionChars} characters: put the detail in a file and point at it`
    );
  if (
    openChildren(parent.id).length + texts.length >
    FORK_LIMITS.maxOpenPerParent
  )
    throw new Error(
      `${FORK_LIMITS.maxOpenPerParent} forks open at once is the most: wait for some to finish`
    );
  const claude = parent.agent_type === "claude";
  // Only the Claude driver runs a guard, so any other agent's children get
  // their own checkout instead.
  const worktree = !claude || !!req.worktree;
  const groupId = newGroupId();
  const children = texts.map((instruction, i) => ({
    childId: randomUUID(),
    label: req.labels?.[i]?.trim() || labelFor(instruction, i),
    instruction,
    worktree,
  }));
  const noteId = `fork-${groupId}`;
  insertGroup({
    id: groupId,
    parentId: parent.id,
    requestId: req.requestId,
    startedBy: req.startedBy,
    context: claude ? "fork" : "brief",
    delivery: req.delivery ?? (req.startedBy === "agent" ? "wake" : "next"),
    forkItemId: noteId,
    children,
  });
  const item = {
    id: noteId,
    kind: "note" as const,
    tone: "note" as const,
    createdAt: Date.now(),
    text: `Forked ${children.length === 1 ? "1 copy" : `${children.length} copies`}: ${children.map((c) => c.label).join(" · ")}`,
  };
  saveItem(parent.id, item);
  emit(parent.id, { type: "item", item });
  const out = children.map((c) => ({
    id: c.childId,
    n: numberOf(parent.id, c.childId),
    label: c.label,
  }));
  runInBackground(() => admitQueued(parent.id), `fork-admit-${groupId}`);
  return { groupId, repeat: false, children: out };
}

const red = () => loadEnabled() && currentLevel() === "red";

// Whether one more child of this parent may start, when it has none open.
function mayStart(parent: Session, running: number): boolean {
  if (running === 0) return true;
  if (running >= FORK_LIMITS.maxRunningPerParent || red()) return false;
  const project = getProject(parent.project_id ?? "");
  const ws = project?.workspace_id ?? null;
  const limit = limitOf(ws);
  if (limit == null) return true;
  const busy =
    runningIn({ workspaceId: ws, projectId: parent.project_id ?? "" }, true)
      .length + (ws ? startingIn(ws) : 0);
  return busy < limit;
}

const STARTED = new Set<ChildRow["state"]>([
  "starting",
  "running",
  "needs_input",
]);

// Starts what the limits allow, oldest first. Called when forks are made,
// when one settles, and by the tick.
export async function admitQueued(parentId: string): Promise<void> {
  const parent = sessionOf(parentId);
  if (!parent || parent.archived_at) return;
  const all = childrenOf(parentId);
  let running = all.filter((c) => STARTED.has(c.state)).length;
  for (const c of all) {
    if (c.state !== "queued") continue;
    if (!mayStart(parent, running)) break;
    setState(c.child_session_id, "starting");
    running++;
    runInBackground(
      () => startChild(c.child_session_id),
      `fork-child-${c.child_session_id}`
    );
  }
}

async function startChild(childId: string): Promise<void> {
  const row = getChild(childId);
  if (!row) return;
  const parent = sessionOf(row.parent_session_id);
  if (!parent) return;
  try {
    const parentCwd = expand(parent.working_directory);
    await ensureScratch(childId);
    const checkout = row.worktree
      ? await createForkWorktree({ childId, parentCwd })
      : null;
    const cwd = checkout?.cwd ?? parentCwd;
    const n = numberOf(parent.id, childId);
    await launchSession({
      id: childId,
      projectId: parent.project_id,
      workingDirectory: checkout?.cwd ?? parent.working_directory,
      agentType: parent.agent_type as AgentType,
      model: parent.model,
      access: parent.chat_access,
      autoApprove: !!parent.auto_approve,
      name: `${parent.name} · fork ${n}`,
      view: "chat",
      parentSessionId: parent.id,
      startedVia: "session",
    });
    db.prepare(
      `UPDATE sessions SET conductor_session_id = ?, model_provider = ? WHERE id = ?`
    ).run(parent.id, parent.model_provider, childId);
    let snapshot: string | undefined;
    if (parent.agent_type === "claude" && parent.claude_session_id) {
      try {
        const forked = await forkConversation({
          claudeSessionId: parent.claude_session_id,
          parentCwd,
          childCwd: cwd,
          title: `fork ${n} of ${parent.name}`,
        });
        db.prepare(
          `UPDATE sessions SET claude_session_id = ?, chat_resume_at = NULL WHERE id = ?`
        ).run(forked.claudeSessionId, childId);
        setCut(childId, forked.cut);
      } catch (error) {
        if (!(error instanceof ForkError)) throw error;
        markFellBack(childId);
        snapshot = await parentSnapshot(parent.id);
      }
    } else snapshot = await parentSnapshot(parent.id);
    const instruction = row.instruction;
    await sendChat(childId, {
      id: `fork-start-${childId}`,
      text: childFirstMessage({
        parentName: parent.name,
        n,
        instruction,
        worktree: !!row.worktree,
        scratch: await ensureScratch(childId),
        snapshot,
        checkout: checkout?.root,
      }),
      from: "AgentOS",
      origin: {
        kind: "event",
        label: `Fork ${n} of ${parent.name}`,
        sessionId: parent.id,
        body: instruction,
      },
    });
    setState(childId, "running");
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    const { settleAndDeliver } = await import("./settle");
    await removeFork(childId).catch(() => undefined);
    await settleAndDeliver(childId, {
      outcome: "failed",
      summary: `couldn't start: ${why.split("\n")[0]}`,
      result: `Fork didn't start: ${why}`,
      kind: "implicit",
    });
  }
}
