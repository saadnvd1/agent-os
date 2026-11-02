/**
 * Adopting an existing chat as a lead. The session keeps its id, its whole
 * chat and its agent's conversation: it restarts on the same conversation
 * with the lead's brief and tools, and is asked to carry what matters across
 * (its memo, and pins proposed from the owner's own messages). Only when the
 * owner confirms the pins, in one tap, does it switch over to a fresh start
 * that reads the memo and the direction instead of the old conversation.
 */

import { db, type Session } from "../db";
import { owner } from "../owner";
import { itemsOfKind } from "../chat/store";
import { originOf } from "../chat/origin";
import {
  chatStateNow,
  freshStartChat,
  sendChat,
  stopChat,
} from "../chat/runner";
import { removeStaleSocket, waitForExit } from "../chat/worker/client";
import { AGENTOS_SENDER } from "../orchestrator/deliver";
import { clip } from "../orchestrator/digest";
import { addNote } from "../orchestrator/notes";
import { resolveProposals } from "./direction";
import { addLeads, getLead, leadTitle, seedCharter } from "./home";
import { latestMemo } from "./memos";
import { isLeadKind, isStandingRole, sqlNoRole } from "./roles";
import { TECH, type DirectionPin, type LeadKind } from "./types";

// How many of the owner's last messages the handover offers as pins.
const OFFERED = 20;

const sessionRow = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
    Session | undefined;

// Why this session can't become this lead, or null.
function refusal(s: Session | undefined, kind: LeadKind): string | null {
  if (!s) return "No such session";
  if (kind === TECH)
    return "The Tech lead is the workspace's orchestrator; adopt another kind";
  if (!isLeadKind(kind)) return `"${kind}" isn't a lead's name`;
  if (isStandingRole(s.role)) return "That session already heads something";
  if (s.view !== "chat" || s.agent_type !== "claude")
    return "Only a Claude chat session can be adopted as a lead";
  if (s.task_status || s.worktree_path)
    return "A task's session can't be a lead";
  if (s.archived_at) return "Unarchive the session first";
  if (s.host_id && s.host_id !== "local")
    return "Only a session on this machine can be adopted";
  return null;
}

function handover(sessionId: string, title: string): string {
  const who = owner();
  const offered = itemsOfKind(sessionId, "user")
    .filter((i) => originOf(i) === null && i.text.trim())
    .slice(-OFFERED)
    .map((i) => `- [item ${i.id}] ${clip(i.text, 300)}`);
  return [
    `You are now this workspace's ${title}. AgentOS kept this conversation, so you still know everything in it; your brief and tools are a lead's from this message on.`,
    `Before you switch over to a fresh start (which carries only your memo and your pinned direction, never this conversation), carry across what matters:`,
    `1. Write your memo with update_memo: what you're working on, what's decided and why, and what's next. Keep it short (about 1.5k tokens).`,
    `2. Propose pins with propose_pin, one call per message, for ${who}'s messages below that set standing direction (not one-off requests). ${who} confirms them with one tap; until he does, none of it is direction.`,
    offered.length
      ? `${who}'s recent messages in this chat:\n${offered.join("\n")}`
      : `${who} has no messages in this chat to pin.`,
    "Then say in a sentence or two what you saved. The switch happens when he confirms.",
  ].join("\n\n");
}

// Stops the session's worker, if one runs, and waits for it to be gone, so
// the next message starts one with the lead's brief and tools.
async function restartWorker(sessionId: string): Promise<void> {
  const state = await chatStateNow(sessionId).catch(() => null);
  if (state === "running" || state === "waiting")
    throw new Error("Adopt it when its current turn has ended");
  stopChat(sessionId);
  await waitForExit(sessionId);
  removeStaleSocket(sessionId);
}

export async function adoptLead(input: {
  sessionId: string;
  workspaceId: string;
  kind: LeadKind;
}): Promise<Session> {
  const { sessionId, workspaceId, kind } = input;
  const why = refusal(sessionRow(sessionId), kind);
  if (why) throw new Error(why);
  if (getLead(workspaceId, kind))
    throw new Error(
      `This workspace already has a ${leadTitle(workspaceId, kind)}`
    );
  await restartWorker(sessionId);
  addLeads(workspaceId, []);
  seedCharter(workspaceId, kind);
  try {
    const changed = db
      .prepare(
        `UPDATE sessions SET role = ?, lead_kind = ?, lead_since = datetime('now'),
           workspace_id = ?, pinned = 1
         WHERE id = ? AND ${sqlNoRole()}`
      )
      .run("lead", kind, workspaceId, sessionId).changes;
    if (!changed) throw new Error("That session already heads something");
  } catch (e) {
    // The unique (workspace, kind) index: someone adopted one just now.
    if (getLead(workspaceId, kind)?.id !== sessionId)
      throw new Error(
        `This workspace already has a ${leadTitle(workspaceId, kind)}`
      );
    throw e;
  }
  db.prepare(
    `INSERT OR REPLACE INTO lead_adoptions (session_id, workspace_id, lead_kind)
     VALUES (?, ?, ?)`
  ).run(sessionId, workspaceId, kind);
  const title = leadTitle(workspaceId, kind);
  addNote(
    workspaceId,
    `Adopted as the ${title}. It writes its memo and proposes pins now; it switches over to a fresh start once ${owner()} confirms them.`,
    "note",
    kind
  );
  await sendChat(sessionId, {
    text: handover(sessionId, title),
    queue: true,
    from: AGENTOS_SENDER,
    origin: { kind: "system", label: "AgentOS" },
  });
  return sessionRow(sessionId)!;
}

// The owner's one tap: pins the proposals confirmed and drops the rest. With
// switchOver, the lead then starts fresh on its memo and direction; an
// adopted lead does this once, after writing its memo.
export async function confirmPins(input: {
  workspaceId: string;
  kind: LeadKind;
  confirm: number[];
  switchOver?: boolean;
}): Promise<{ pins: DirectionPin[]; fresh: "now" | "after-turn" | null }> {
  const { workspaceId, kind } = input;
  const lead = getLead(workspaceId, kind);
  if (!lead) throw new Error("This workspace has no such lead");
  if (input.switchOver && !latestMemo(workspaceId, kind))
    throw new Error(
      "It hasn't written its memo yet, so a fresh start would lose its history"
    );
  const pins = resolveProposals(workspaceId, kind, input.confirm);
  const fresh = input.switchOver ? await freshStartChat(lead.id) : null;
  if (fresh)
    db.prepare(
      `UPDATE lead_adoptions SET switched_at = datetime('now')
       WHERE session_id = ? AND switched_at IS NULL`
    ).run(lead.id);
  return { pins, fresh };
}

// An adopted lead still on its old conversation, waiting for the owner's
// tap on its proposed pins.
export function switchPending(sessionId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM lead_adoptions WHERE session_id = ? AND switched_at IS NULL`
    )
    .get(sessionId);
}
