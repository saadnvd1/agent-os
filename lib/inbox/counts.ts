// What the Inbox lists and counts. Pure and client-safe, so the button, the
// panel and the tests share one rule.

import {
  needsYouItems,
  type NeedsYouItem,
} from "../orchestrator/needs-you-items";
import type { AskView, QuestionView } from "../orchestrator/ask-view";

export type InboxTab = "needs" | "tasks" | "messages";
export const INBOX_TABS: readonly InboxTab[] = ["needs", "tasks", "messages"];

export interface NeedsRow {
  key: string;
  kind: "input" | "ask" | "question";
  title: string;
  sub: string;
  at: number;
  // The session or task this is about, when known; what keeps one session
  // from being counted twice.
  sessionId: string | null;
  workspaceId: string | null;
  ask?: AskView;
  question?: QuestionView;
}

export interface OverviewLike {
  workspaceId: string;
  asks: AskView[];
  questions: QuestionView[];
  dismissed: string[];
}

const TASK_PREFIX = "task:";

export function needsYouRows(input: {
  waiting: { id: string; name: string }[];
  overviews: OverviewLike[];
}): NeedsRow[] {
  const rows: NeedsRow[] = [];
  for (const o of input.overviews) {
    const items = needsYouItems({
      asks: o.asks,
      questions: o.questions,
      dismissed: o.dismissed,
    });
    for (const item of items) {
      const row = fromItem(item, o.workspaceId);
      if (row) rows.push(row);
    }
  }
  const covered = new Set(
    rows.flatMap((r) => (r.sessionId ? [r.sessionId] : []))
  );
  for (const s of input.waiting)
    if (!covered.has(s.id))
      rows.push({
        key: `input:${s.id}`,
        kind: "input",
        title: s.name,
        sub: "Waiting for input",
        at: 0,
        sessionId: s.id,
        workspaceId: null,
      });
  return rows.sort((a, b) => b.at - a.at);
}

function fromItem(item: NeedsYouItem, workspaceId: string): NeedsRow | null {
  if (item.kind === "ask")
    return {
      key: item.key,
      kind: "ask",
      title: item.title,
      sub: item.sub,
      at: item.at,
      sessionId: item.ask.subject.startsWith(TASK_PREFIX)
        ? item.ask.subject.slice(TASK_PREFIX.length)
        : null,
      workspaceId,
      ask: item.ask,
    };
  if (item.kind === "question")
    return {
      key: item.key,
      kind: "question",
      title: item.title,
      sub: item.sub,
      at: item.at,
      sessionId: item.question.task,
      workspaceId,
      question: item.question,
    };
  return null;
}

export function unreadCount(
  messages: { id: number }[],
  seenId: number | null
): number {
  if (seenId === null) return 0;
  return messages.filter((m) => m.id > seenId).length;
}

export interface InboxCounts {
  needs: number;
  tasks: number;
  messages: number;
  total: number;
}

// The badge counts each session once: a task needing you that is already a
// Needs-you row (waiting for input, or the subject of an ask) adds nothing.
export function inboxCounts(input: {
  rows: NeedsRow[];
  tasksNeedingYou: string[];
  unread: number;
}): InboxCounts {
  const covered = new Set(
    input.rows.flatMap((r) => (r.sessionId ? [r.sessionId] : []))
  );
  const extraTasks = input.tasksNeedingYou.filter((id) => !covered.has(id));
  return {
    needs: input.rows.length,
    tasks: input.tasksNeedingYou.length,
    messages: input.unread,
    total: input.rows.length + extraTasks.length + input.unread,
  };
}

// Needs you when it has items, else the tab he used last.
export function pickTab(input: {
  explicit?: InboxTab;
  needs: number;
  last: InboxTab | null;
}): InboxTab {
  if (input.explicit) return input.explicit;
  if (input.needs > 0) return "needs";
  return input.last ?? "needs";
}
