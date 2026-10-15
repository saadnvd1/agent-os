// What the Needs-you strip lists: everything waiting on Saad, newest first.
// Client-safe and pure, so the strip and its tests share one rule.

import { NEED_LABEL, type SessionNeed } from "../sidebar/shelves";
import type { PendingCardView } from "../learning-cards/types";
import type { AskView, QuestionView } from "./ask-view";

export type NeedsYouItem =
  | {
      key: string;
      kind: "ask";
      title: string;
      sub: string;
      at: number;
      ask: AskView;
    }
  | {
      key: string;
      kind: "question";
      title: string;
      sub: string;
      at: number;
      question: QuestionView;
    }
  // A learning card a finished session left, waiting to be kept or dropped.
  | {
      key: string;
      kind: "card";
      title: string;
      sub: string;
      at: number;
      card: PendingCardView;
    }
  // The orchestrator's own chat waiting on an approval or an answer.
  | { key: string; kind: "chat"; title: string; sub: string; at: number }
  | {
      key: string;
      kind: "task";
      title: string;
      sub: string;
      at: number;
      sessionId: string;
    };

export interface TaskNeed {
  sessionId: string;
  name: string;
  need: SessionNeed;
}

// SQLite datetime('now') is UTC without a zone marker.
export const sqliteMs = (t: string) =>
  Date.parse(`${t.replace(" ", "T")}Z`) || 0;

// Those he can act on from the strip. A failed or unsent task isn't a
// question to him.
const TASK_NEEDS: readonly SessionNeed[] = [
  "approve",
  "answer",
  "signin",
  "input",
];

export function needsYouItems(input: {
  asks: AskView[];
  questions: QuestionView[];
  dismissed: readonly string[];
  tasks?: TaskNeed[];
  cards?: PendingCardView[];
  chatWaiting?: boolean;
  chatKey?: string;
}): NeedsYouItem[] {
  const hidden = new Set(input.dismissed);
  const items: NeedsYouItem[] = [
    ...input.asks.map(
      (ask): NeedsYouItem => ({
        key: `ask:${ask.id}`,
        kind: "ask",
        title: ask.title,
        sub: ask.kind,
        at: sqliteMs(ask.createdAt),
        ask,
      })
    ),
    ...input.questions.map(
      (question): NeedsYouItem => ({
        key: `question:${question.id}`,
        kind: "question",
        title: question.text,
        sub: question.taskName ?? "Question",
        at: sqliteMs(question.createdAt),
        question,
      })
    ),
  ];
  for (const card of input.cards ?? [])
    items.push({
      key: `card:${card.id}`,
      kind: "card",
      title: card.title,
      sub: card.sessionName,
      at: card.createdAt,
      card,
    });
  if (input.chatWaiting)
    items.push({
      key: input.chatKey ?? "approval:chat",
      kind: "chat",
      title: "Waiting for your answer in chat",
      sub: "Answer",
      at: Date.now(),
    });
  for (const t of input.tasks ?? [])
    if (TASK_NEEDS.includes(t.need))
      items.push({
        key: `task:${t.sessionId}`,
        kind: "task",
        title: t.name,
        sub: NEED_LABEL[t.need],
        at: 0,
        sessionId: t.sessionId,
      });
  return items.filter((i) => !hidden.has(i.key)).sort((a, b) => b.at - a.at);
}
