import fs from "fs";
import path from "path";
import { db } from "../db";
import type { Session } from "../db";
import { lastItems, listItems } from "../chat/store";
import { untrusted } from "../orchestrator/untrusted";
import { readExternal, readResolved } from "../orchestrator/read";
import { findExternalSession } from "../orchestrator/external-sessions";
import { pieceOfSession, planPathOf } from "../plans/features";
import { hostLink } from "../hosts/remote-api";
import {
  readerScope,
  resolveReadable,
  type ReadableSession,
} from "./read-scope";
import {
  READ_DEFAULT_TURNS,
  TERMINAL_LINES,
  TERMINAL_LINES_ALL,
  condenseItems,
  grepTurns,
  renderTurns,
  type Rendered,
} from "./condense";

export interface ReadOpts {
  turns?: number;
  lines?: number;
  all?: boolean;
  grep?: string;
}

export interface ReadResult {
  // Ours, not another session's text: who, what state, how much.
  header: string;
  // Another session's text, fenced and redacted.
  text: string;
  session: { id: string | null; name: string; project: string | null };
  task: { prompt: string | null; plan: string | null } | null;
  turns: { from: number; to: number; total: number } | null;
  truncated: boolean;
}

const PLAN_FILE = ".agentos/plan.md";
const PROMPT_CAP = 1500;
// Items fetched per turn asked for, when the whole chat isn't needed.
const ITEMS_PER_TURN = 400;

export class ReadError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function stateOf(s: Session): string {
  if (s.archived_at) return "archived";
  return s.task_status ?? "running";
}

function planOf(s: Session): string | null {
  if (s.worktree_path) {
    const own = path.join(s.worktree_path, PLAN_FILE);
    if (fs.existsSync(own)) return own;
  }
  const piece = pieceOfSession(s.id);
  const fromFeature = piece ? planPathOf(piece.feature_id) : null;
  return fromFeature && fs.existsSync(fromFeature) ? fromFeature : null;
}

function taskHeader(s: Session, all: boolean) {
  if (!s.task_prompt) return null;
  const p = s.task_prompt.trim();
  return {
    prompt: !all && p.length > PROMPT_CAP ? `${p.slice(0, PROMPT_CAP)}…` : p,
    plan: planOf(s),
  };
}

function userCount(sessionId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM chat_items WHERE session_id = ? AND kind = 'user'`
      )
      .get(sessionId) as { n: number }
  ).n;
}

function chatTurns(s: Session, o: ReadOpts) {
  const total = userCount(s.id);
  if (o.all || o.grep) return { turns: condenseItems(listItems(s.id)), total };
  const asked = o.lines
    ? Math.ceil(o.lines / 4) + 1
    : (o.turns ?? READ_DEFAULT_TURNS);
  const items = lastItems(s.id, Math.min(asked * ITEMS_PER_TURN, 4000));
  const inWindow = items.filter((i) => i.kind === "user").length;
  return { turns: condenseItems(items, Math.max(total - inWindow, 0)), total };
}

// What a session in the caller's workspace said and did, condensed.
export async function readPeer(
  callerId: string,
  ref: string,
  o: ReadOpts = {}
): Promise<ReadResult> {
  let found;
  try {
    found = resolveReadable(callerId, ref);
  } catch (error) {
    throw new ReadError(
      error instanceof Error ? error.message : String(error),
      403
    );
  }
  if (!found.ok) {
    const scope = readerScope(callerId);
    const external =
      found.external && scope.workspaceId
        ? await findExternalSession(scope.workspaceId, ref).catch(() => null)
        : null;
    if (external) {
      const n = o.lines ?? (o.all ? TERMINAL_LINES_ALL : TERMINAL_LINES);
      return {
        header: `${external.ref} (external terminal)`,
        text: await readExternal(external, n),
        session: { id: null, name: external.ref, project: null },
        task: null,
        turns: null,
        truncated: false,
      };
    }
    throw new ReadError(found.error, found.external ? 404 : 403);
  }
  const s: ReadableSession = found.session;
  const who = { id: s.id, name: s.name, project: s.project_name };
  const label = `${s.project_name ? `${s.project_name}/` : ""}${s.name}`;
  const task = taskHeader(s, !!o.all);
  const note = found.note ? ` (${found.note})` : "";

  if (s.view !== "chat" || hostLink(s.host_id)) {
    const n =
      o.lines ?? (o.all || o.grep ? TERMINAL_LINES_ALL : TERMINAL_LINES);
    return {
      header: `${label}${note}: ${s.view}, ${stateOf(s)}`,
      text: await readResolved(s, n, o.grep),
      session: who,
      task,
      turns: null,
      truncated: false,
    };
  }

  const { turns, total } = chatTurns(s, o);
  const r: Rendered = o.grep
    ? grepTurns(turns, o.grep, { all: o.all })
    : renderTurns(turns, o);
  const taskText = task
    ? `Task brief:\n${task.prompt}${task.plan ? `\nPlan: ${task.plan}` : ""}\n\n`
    : "";
  const body = r.text
    ? r.text
    : o.grep
      ? `no turns match "${o.grep}"`
      : "(no messages yet)";
  const range = r.to
    ? `turns ${r.from === r.to ? r.to : `${r.from}-${r.to}`} of ${total}`
    : `${total} turns`;
  const more =
    r.truncated && !o.all ? "; more with --turns N, --grep or --all" : "";
  return {
    header: `${label}${note} (chat, ${stateOf(s)}), ${o.grep ? `matches for "${o.grep}", ` : ""}${range}${more}`,
    text: untrusted(s.name, `${taskText}${body}`),
    session: who,
    task,
    turns: { from: r.from, to: r.to, total },
    truncated: r.truncated,
  };
}
