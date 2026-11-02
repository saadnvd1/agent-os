/**
 * What a lead carries across a fresh start: its pinned direction (all of it,
 * newest first), its memo, the pins it proposed, unread mail from other
 * leads, and its own asks, work and decision log. Read from the database at
 * every start, no model involved, under the same token budget as the
 * orchestrator's digest.
 */

import { db } from "../db";
import { owner } from "../owner";
import {
  CHARS_PER_TOKEN,
  clip,
  DIGEST_TOKENS,
  renderDigest,
  type Section,
} from "../orchestrator/digest";
import { openAsks } from "../orchestrator/asks";
import { shortId } from "../orchestrator/describe";
import { untrusted } from "../orchestrator/untrusted";
import { currentDirection, openProposals } from "./direction";
import { latestMemo } from "./memos";
import { unreadFor } from "./messages";
import { leadTitle } from "./home";
import type { LeadKind } from "./types";

const QUOTE_CAP = 600;
const NOTES_SCANNED = 100;
// What Tech's digest adds once its workspace has leads.
export const TECH_LEAD_TOKENS = 1500;

function directionSection(w: string, kind: LeadKind): Section {
  return {
    title: `Pinned direction, from ${owner()}, newest first`,
    // The server copied each quote from his own message: it's his word.
    lines: currentDirection(w, kind).map(
      (p) =>
        `- [pin ${p.id}, ${p.setAt.slice(0, 10)}] "${clip(p.quote, QUOTE_CAP)}"`
    ),
    empty: `- None yet. Only ${owner()} sets direction; propose a pin with propose_pin.`,
    more: "direction",
  };
}

function memoSection(w: string, kind: LeadKind): Section {
  const memo = latestMemo(w, kind);
  return {
    title: "Your memo",
    // Written by the lead from what it read: it informs, never authorizes.
    lines: memo
      ? [
          `(${memo.createdAt.slice(0, 16)} UTC) ${untrusted("your memo", memo.text)}`,
        ]
      : [],
    empty: "- None yet. Write one with update_memo.",
    more: "direction",
  };
}

function proposalsSection(w: string, kind: LeadKind): Section {
  return {
    title: `Pins you proposed, waiting for ${owner()}`,
    lines: openProposals(w, kind).map(
      (p) => `- [proposal ${p.id}] "${clip(p.quote, QUOTE_CAP)}"`
    ),
    more: "direction",
  };
}

function mailSection(w: string, kind: LeadKind): Section {
  return {
    title: "Unread mail from other leads",
    lines: unreadFor(w, kind).map(
      (m) =>
        `- [${m.createdAt.slice(0, 16)} UTC, from ${m.fromKind}, thread "${clip(m.thread, 80)}"] ${untrusted(`the ${m.fromKind} lead`, clip(m.text))}`
    ),
    more: "",
  };
}

function asksSection(w: string, kind: LeadKind): Section {
  return {
    title: `Your open asks (waiting on ${owner()})`,
    lines: openAsks(w)
      .filter((a) => a.lead_kind === kind)
      .map(
        (a) =>
          `- [ask ${a.id}] ${a.kind}: ${untrusted("ask title", clip(a.title, 160))}`
      ),
    empty: "- None.",
    more: "",
  };
}

function workSection(sessionId: string): Section {
  const rows = db
    .prepare(
      `SELECT id, name, task_status, pr_number FROM session_rows
       WHERE started_by = ? AND archived_at IS NULL
         AND (task_status IS NULL OR task_status = 'running')
       ORDER BY created_at DESC LIMIT 30`
    )
    .all(sessionId) as {
    id: string;
    name: string;
    task_status: string | null;
    pr_number: number | null;
  }[];
  return {
    title: "Work you started, still open",
    lines: rows.map(
      (r) =>
        `- ${shortId(r.id)} ${untrusted("session name", clip(r.name, 80))}${r.task_status ? " (task)" : ""}${r.pr_number ? ` PR #${r.pr_number}` : ""}`
    ),
    empty: "- None.",
    more: "sessions",
  };
}

function notesSection(w: string, kind: LeadKind): Section {
  const rows = db
    .prepare(
      `SELECT kind, text, created_at FROM orchestrator_notes
       WHERE workspace_id = ? AND lead_kind = ? ORDER BY id DESC LIMIT ?`
    )
    .all(w, kind, NOTES_SCANNED) as {
    kind: string;
    text: string;
    created_at: string;
  }[];
  return {
    title: "Your decision log, newest first",
    lines: rows.map(
      (n) =>
        `- ${n.created_at.slice(0, 16)} UTC${n.kind === "note" ? "" : ` ${n.kind}`}: ${untrusted(n.kind === "note" ? "your note" : `${n.kind} log line`, clip(n.text))}`
    ),
    more: "",
  };
}

// A lead's whole digest. Tech's (`tech`) is only what its own digest lacks:
// direction, memo, proposals and mail.
export function buildLeadDigest(
  w: string,
  kind: LeadKind,
  opts: { sessionId: string; tech?: boolean },
  budgetTokens = opts.tech ? TECH_LEAD_TOKENS : DIGEST_TOKENS
): string {
  const head = opts.tech
    ? `## Your direction as ${leadTitle(w, kind)}`
    : "## Where things stand (read from AgentOS's database as you started)";
  const sections = [
    directionSection(w, kind),
    memoSection(w, kind),
    proposalsSection(w, kind),
    mailSection(w, kind),
    ...(opts.tech
      ? []
      : [
          asksSection(w, kind),
          workSection(opts.sessionId),
          notesSection(w, kind),
        ]),
  ];
  return `${head}\n\n${renderDigest(sections, budgetTokens - Math.ceil((head.length + 2) / CHARS_PER_TOKEN))}`;
}
