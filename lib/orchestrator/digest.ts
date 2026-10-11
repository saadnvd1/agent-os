/**
 * What an orchestrator knows when it starts: the workspace's state read
 * straight from the database, no model involved. It goes in the brief on
 * every start, so a fresh conversation (a new orchestrator, or one started
 * over at its context threshold) loses nothing that matters. Sections run
 * most important first and the whole stays under a token budget; ordering
 * is by id, so the same database gives the same text.
 */

import { db } from "../db";
import { openAsks } from "./asks";
import { listRules } from "./rules";
import { shortId } from "./describe";
import { untrusted } from "./untrusted";

// About four characters a token: close enough to cap a prompt.
export const CHARS_PER_TOKEN = 4;
export const DIGEST_TOKENS = 4000;
const LINE_CAP = 300;
const NOTES_SCANNED = 200;
// An external PR gated this recently is still worth a line.
const EXTERNAL_DAYS = 2;

// One line, cut to length. A cut that leaves a fence around another
// session's text open closes it, so what follows isn't read as inside it.
const clip = (text: string, cap = LINE_CAP) => {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= cap) return one;
  const cut = `${one.slice(0, cap - 3)}...`;
  const opens = cut.match(/<untrusted[\s>]/g)?.length ?? 0;
  const closes = cut.match(/<\/untrusted>/g)?.length ?? 0;
  return opens > closes ? `${cut}</untrusted>` : cut;
};

const sha7 = (sha: string | null) => (sha ? sha.slice(0, 7) : "?");

interface Section {
  title: string;
  lines: string[];
  // Shown when the section is empty; omitted otherwise.
  empty?: string;
  // How to see what didn't fit.
  more: string;
}

interface TaskRow {
  id: string;
  name: string;
  project: string | null;
  pr_number: number | null;
  pr_status: string | null;
  view: string;
  armed_at: string | null;
}

interface CheckRow {
  session_id: string;
  sha: string;
  kind: string;
  status: string;
}

interface FailureRow {
  session_id: string;
  gate: string;
  count: number;
  escalated_at: string | null;
}

function checksBySession(workspaceId: string): Map<string, CheckRow[]> {
  // The newest verdict of each kind per session or PR.
  const rows = db
    .prepare(
      `SELECT c.session_id, c.sha, c.kind, c.status FROM orchestrator_checks c
       WHERE c.workspace_id = ? AND c.id = (
         SELECT MAX(id) FROM orchestrator_checks
         WHERE workspace_id = c.workspace_id AND session_id = c.session_id
           AND kind = c.kind)
       ORDER BY c.session_id, c.kind`
    )
    .all(workspaceId) as CheckRow[];
  const by = new Map<string, CheckRow[]>();
  for (const r of rows)
    by.set(r.session_id, [...(by.get(r.session_id) ?? []), r]);
  return by;
}

function failuresBySession(workspaceId: string): Map<string, FailureRow[]> {
  const rows = db
    .prepare(
      `SELECT session_id, gate, count, escalated_at FROM orchestrator_gate_failures
       WHERE workspace_id = ? AND count > 0 ORDER BY session_id, gate`
    )
    .all(workspaceId) as FailureRow[];
  const by = new Map<string, FailureRow[]>();
  for (const r of rows)
    by.set(r.session_id, [...(by.get(r.session_id) ?? []), r]);
  return by;
}

function gateState(
  checks: CheckRow[] = [],
  failures: FailureRow[] = []
): string {
  const parts: string[] = [];
  if (checks.length)
    parts.push(
      checks.map((c) => `${c.kind} ${c.status}@${sha7(c.sha)}`).join(", ")
    );
  const failed = failures.map(
    (f) =>
      `${f.gate} failed ${f.count}x${f.escalated_at ? " (Saad's now)" : ""}`
  );
  if (failed.length) parts.push(failed.join(", "));
  return parts.join("; ");
}

function rulesSection(workspaceId: string): Section {
  return {
    title: "Standing rules",
    // Saad's in plain text; its own fenced, since it writes them from what
    // it read: a line planted there can't pass for his word.
    lines: listRules(workspaceId).map((r) =>
      r.added_by === "saad"
        ? `- [rule ${r.id}, from Saad] ${clip(r.text)}`
        : `- [rule ${r.id}, kept by you] ${untrusted("a rule you kept", clip(r.text))}`
    ),
    empty: "- None. Keep one with rule_add.",
    more: "",
  };
}

function asksSection(workspaceId: string): Section {
  return {
    title: "Open asks (waiting on Saad)",
    lines: openAsks(workspaceId).map((a) => {
      const on = a.subject.startsWith("task:")
        ? ` | task ${shortId(a.subject.slice(5))}`
        : a.subject.startsWith("pr:")
          ? ` | ${a.subject.slice(3)}`
          : "";
      const at = a.sha ? `@${sha7(a.sha)}` : "";
      return `- [ask ${a.id}] ${a.kind}: ${untrusted("ask title", clip(a.title, 160))}${on}${at}`;
    }),
    empty: "- None.",
    more: "",
  };
}

function tasksSection(
  workspaceId: string,
  checks: Map<string, CheckRow[]>,
  failures: Map<string, FailureRow[]>
): Section {
  const tasks = db
    .prepare(
      `SELECT s.id, s.name, p.name AS project, s.pr_number, s.pr_status, s.view,
         s.merge_armed_at AS armed_at
       FROM sessions s JOIN projects p ON p.id = s.project_id
       WHERE p.workspace_id = ? AND s.role IS NULL AND s.archived_at IS NULL
         AND s.task_status = 'running'
       ORDER BY s.created_at, s.id`
    )
    .all(workspaceId) as TaskRow[];
  return {
    title: "Running tasks",
    lines: tasks.map((t) => {
      const pr = t.pr_number
        ? `PR #${t.pr_number} ${t.pr_status ?? "open"}`
        : "no PR yet";
      const gates = gateState(checks.get(t.id), failures.get(t.id));
      const arm = t.armed_at ? " | armed to merge" : "";
      return `- ${clip(t.name, 80)} (${t.project ?? "?"}, ${t.view}, id ${shortId(t.id)}): ${pr}${arm}${gates ? ` | ${gates}` : ""}`;
    }),
    empty: "- None.",
    more: "the sessions tool",
  };
}

function externalSection(
  workspaceId: string,
  checks: Map<string, CheckRow[]>,
  failures: Map<string, FailureRow[]>
): Section {
  const recent = db
    .prepare(
      `SELECT session_id FROM orchestrator_checks
       WHERE workspace_id = ? AND session_id LIKE 'pr:%'
         AND created_at >= datetime('now', ?)
       GROUP BY session_id ORDER BY session_id`
    )
    .all(workspaceId, `-${EXTERNAL_DAYS} days`) as { session_id: string }[];
  return {
    title: `External PRs gated in the last ${EXTERNAL_DAYS} days (may have merged since)`,
    lines: recent.map(
      ({ session_id }) =>
        `- ${session_id.slice(3)} | ${gateState(checks.get(session_id), failures.get(session_id))}`
    ),
    more: "review on the PR",
  };
}

function queueSection(workspaceId: string): Section {
  const rows = db
    .prepare(
      `SELECT q.id, q.name, q.prompt, q.status, q.after_task, q.after_any,
         p.name AS project, a.name AS after_name
       FROM task_queue q JOIN projects p ON p.id = q.project_id
       LEFT JOIN sessions a ON a.id = q.after_task
       WHERE p.workspace_id = ? AND q.status IN ('queued', 'starting', 'failed')
       ORDER BY q.position`
    )
    .all(workspaceId) as {
    id: string;
    name: string | null;
    prompt: string;
    status: string;
    after_task: string | null;
    after_any: string | null;
    project: string;
    after_name: string | null;
  }[];
  return {
    title: "Queued tasks, in line order",
    lines: rows.map((r, i) => {
      const after = r.after_task
        ? ` | after ${r.after_name ?? shortId(r.after_task)}`
        : r.after_any
          ? " | after any running task"
          : "";
      const status = r.status === "queued" ? "" : ` | ${r.status}`;
      return `- ${i + 1}. ${clip(r.name ?? r.prompt, 80)} (${r.project}, id ${shortId(r.id)})${after}${status}`;
    }),
    more: "the sessions tool",
  };
}

function schedulesSection(workspaceId: string): Section {
  const rows = db
    .prepare(
      `SELECT name, cron, timezone, prompt, enabled FROM schedules
       WHERE workspace_id = ? AND archived_at IS NULL ORDER BY created_at, id`
    )
    .all(workspaceId) as {
    name: string;
    cron: string;
    timezone: string;
    prompt: string;
    enabled: number;
  }[];
  return {
    title: "Schedules",
    lines: rows.map(
      (s) =>
        `- "${clip(s.name, 60)}" ${s.cron} ${s.timezone}${s.enabled ? "" : " (off)"}: ${clip(s.prompt, 160)}`
    ),
    more: "`aos schedules`",
  };
}

function notesSection(workspaceId: string): Section {
  const rows = db
    .prepare(
      `SELECT kind, text, created_at FROM orchestrator_notes
       WHERE workspace_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(workspaceId, NOTES_SCANNED) as {
    kind: string;
    text: string;
    created_at: string;
  }[];
  return {
    title: "Decision log, newest first",
    lines: rows.map(
      (n) =>
        `- ${n.created_at.slice(0, 16)} UTC${n.kind === "note" ? "" : ` ${n.kind}`}: ${untrusted(n.kind === "note" ? "your note" : `${n.kind} log line`, clip(n.text))}`
    ),
    more: "",
  };
}

// Sections in order until the budget runs out; a section cut short says
// how many lines it left out and where to find them.
export function renderDigest(
  sections: Section[],
  budgetTokens: number
): string {
  const budget = budgetTokens * CHARS_PER_TOKEN;
  const out: string[] = [];
  let used = 0;
  const fits = (text: string) => used + text.length + 1 <= budget;
  const put = (text: string) => {
    out.push(text);
    used += text.length + 1;
  };
  for (const s of sections) {
    const lines = s.lines.length ? s.lines : s.empty ? [s.empty] : [];
    if (!lines.length) continue;
    const head = `\n### ${s.title}`;
    if (!fits(`${head}\n${lines[0]}`)) break;
    put(head);
    let shown = 0;
    for (const line of lines) {
      if (!fits(line)) break;
      put(line);
      shown++;
    }
    const left = lines.length - shown;
    if (left) {
      const more = `- ...and ${left} more${s.more ? ` (see ${s.more})` : ""}.`;
      if (fits(more)) put(more);
      break;
    }
  }
  return out.join("\n").trim();
}

export function buildDigest(
  workspaceId: string,
  budgetTokens = DIGEST_TOKENS
): string {
  const checks = checksBySession(workspaceId);
  const failures = failuresBySession(workspaceId);
  const head =
    "## Where things stand (read from AgentOS's database as you started)";
  const body = renderDigest(
    [
      rulesSection(workspaceId),
      asksSection(workspaceId),
      tasksSection(workspaceId, checks, failures),
      externalSection(workspaceId, checks, failures),
      queueSection(workspaceId),
      schedulesSection(workspaceId),
      notesSection(workspaceId),
    ],
    budgetTokens - Math.ceil((head.length + 2) / CHARS_PER_TOKEN)
  );
  return `${head}\n\n${body}`;
}
