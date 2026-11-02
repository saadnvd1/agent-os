// The chief of staff's view of its own workspace: what each lead recorded
// (pinned direction, memo, decision log, open asks, work it started) and
// the headers of the threads between them. Records, never a lead's chat;
// one workspace only, and capped so a busy company can't grow the chief's
// context. A thread's text is read only when the chief asks for it.

import { db } from "../db";
import { owner } from "../owner";
import { clip, CHARS_PER_TOKEN, renderDigest } from "../orchestrator/digest";
import type { Section } from "../orchestrator/digest";
import { openAsks } from "../orchestrator/asks";
import { untrusted } from "../orchestrator/untrusted";
import { getWorkspace } from "../workspaces";
import { currentDirection } from "./direction";
import { leadTitle, listLeads } from "./home";
import { latestMemo } from "./memos";
import { threadMessages } from "./messages";
import { leadKindOf, sqlNoRole } from "./roles";
import { TECH, type LeadKind } from "./types";

export const COMPANY_TOKENS = 3000;
const PINS_SHOWN = 3;
const NOTES_SHOWN = 3;
const THREADS_SHOWN = 12;
const THREAD_TEXT = 20;
const MEMO_CAP = 500;

interface ThreadHead {
  thread: string;
  a: string;
  b: string;
  n: number;
  last_at: string;
  // SQLite takes it from the row MAX(id) picked: the newest message.
  last_from: string;
}

// Each thread once (a topic between one pair, either way), newest first.
export function threadHeads(workspaceId: string, limit = THREADS_SHOWN) {
  return db
    .prepare(
      `SELECT thread, MIN(from_kind, to_kind) AS a, MAX(from_kind, to_kind) AS b,
         COUNT(*) AS n, MAX(created_at) AS last_at, from_kind AS last_from, MAX(id) AS last_id
       FROM lead_messages WHERE workspace_id = ?
       GROUP BY thread, a, b ORDER BY last_id DESC LIMIT ?`
    )
    .all(workspaceId, limit) as ThreadHead[];
}

// Running work a lead started, and for Tech the workspace's unattributed
// tasks too (it runs the workspace's code).
function workCounts(workspaceId: string, kind: LeadKind) {
  const who =
    kind === TECH
      ? `(started_by_lead = 'tech' OR started_by_lead IS NULL)`
      : `started_by_lead = ?`;
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(task_status = 'running' AND pr_number IS NULL), 0) AS running,
         COALESCE(SUM(task_status = 'running' AND pr_number IS NOT NULL), 0) AS review,
         COALESCE(SUM(task_status IS NULL), 0) AS sessions
       FROM session_rows
       WHERE workspace_id = ? AND ${sqlNoRole()} AND archived_at IS NULL
         AND (task_status IS NULL OR task_status = 'running') AND ${who}`
    )
    .get(...(kind === TECH ? [workspaceId] : [workspaceId, kind])) as {
    running: number;
    review: number;
    sessions: number;
  };
  return row;
}

function notes(workspaceId: string, kind: LeadKind) {
  return db
    .prepare(
      `SELECT text, created_at FROM orchestrator_notes
       WHERE workspace_id = ? AND lead_kind = ? AND kind = 'note'
       ORDER BY id DESC LIMIT ?`
    )
    .all(workspaceId, kind, NOTES_SHOWN) as {
    text: string;
    created_at: string;
  }[];
}

function leadSection(workspaceId: string, kind: LeadKind): Section {
  const title = leadTitle(workspaceId, kind);
  const pins = currentDirection(workspaceId, kind);
  const memo = latestMemo(workspaceId, kind);
  const asks = openAsks(workspaceId).filter((a) => a.lead_kind === kind);
  const w = workCounts(workspaceId, kind);
  const lines = [
    `- Work: ${w.running} task${w.running === 1 ? "" : "s"} running, ${w.review} in review, ${w.sessions} open session${w.sessions === 1 ? "" : "s"}.`,
    pins.length
      ? `- Direction (${pins.length} pinned, ${owner()}'s words, newest first):`
      : "- Direction: none pinned.",
    ...pins
      .slice(0, PINS_SHOWN)
      .map(
        (p) => `  - [pin ${p.id}, ${p.setAt.slice(0, 10)}] "${clip(p.quote)}"`
      ),
    memo
      ? `- Memo (${memo.createdAt.slice(0, 10)}): ${untrusted(`the ${title}'s memo`, clip(memo.text, MEMO_CAP))}`
      : "- Memo: none written.",
    ...asks.map(
      (a) =>
        `- Open ask ${a.id} (${a.kind}): ${untrusted("ask title", clip(a.title, 160))}`
    ),
    ...notes(workspaceId, kind).map(
      (n) =>
        `- Decision ${n.created_at.slice(0, 10)}: ${untrusted(`the ${title}'s note`, clip(n.text, 200))}`
    ),
  ];
  return { title: `${title} (${kind})`, lines, more: "" };
}

function threadsSection(workspaceId: string): Section {
  return {
    title:
      "Threads between leads (headers only; company with thread reads one)",
    lines: threadHeads(workspaceId).map(
      (t) =>
        `- "${t.thread}": ${t.a} and ${t.b}, ${t.n} message${t.n === 1 ? "" : "s"}, last from ${t.last_from} at ${t.last_at.slice(0, 16)} UTC`
    ),
    empty: "- None.",
    more: "",
  };
}

// The chief's own open asks and the ones no lead raised.
function chiefAsksSection(workspaceId: string): Section {
  return {
    title: `Your open asks (waiting on ${owner()})`,
    lines: openAsks(workspaceId)
      .filter((a) => a.lead_kind === "chief")
      .map(
        (a) =>
          `- [ask ${a.id}] ${a.kind}: ${untrusted("ask title", clip(a.title, 160))}`
      ),
    more: "",
  };
}

export function companyText(
  workspaceId: string,
  budgetTokens = COMPANY_TOKENS
): string {
  const ws = getWorkspace(workspaceId)?.name ?? "this workspace";
  const kinds = listLeads(workspaceId)
    .map((s) => leadKindOf(s))
    .filter((k): k is LeadKind => !!k);
  const head = `## The "${ws}" workspace, from what its leads recorded (not their chats)`;
  const body = renderDigest(
    [
      ...kinds.map((k) => leadSection(workspaceId, k)),
      chiefAsksSection(workspaceId),
      threadsSection(workspaceId),
    ],
    budgetTokens - Math.ceil((head.length + 2) / CHARS_PER_TOKEN)
  );
  return `${head}\n\n${body}`;
}

// One thread's text, on the chief's request: the leads' own words, fenced.
export function companyThread(workspaceId: string, thread: string): string {
  const name = thread.trim();
  const messages = threadMessages(workspaceId, name, THREAD_TEXT);
  if (!messages.length)
    throw new Error(
      `No thread "${name}" in this workspace; company lists the threads`
    );
  const lines = messages.map(
    (m) =>
      `- #${m.id} ${m.createdAt.slice(0, 16)} UTC, ${m.fromKind} to ${m.toKind}${m.pins.length ? ` (cites pin ${m.pins.join(", ")})` : ""}: ${untrusted(`the ${leadTitle(workspaceId, m.fromKind)}`, clip(m.text, 1200))}`
  );
  return renderDigest(
    [{ title: `Thread "${name}", oldest first`, lines, more: "" }],
    COMPANY_TOKENS
  );
}
