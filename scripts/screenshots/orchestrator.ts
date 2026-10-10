import type { ChatItem } from "../../lib/chat/events";

// The Work workspace's orchestrator, mid-morning: AgentOS tells it what
// changed, it reviews and merges what passes the gates, and parks what is
// yours to decide as asks.

const event = (id: string, createdAt: number, lines: string[]): ChatItem => ({
  id,
  createdAt,
  kind: "user",
  text: lines.join("\n"),
  from: "agentos",
  origin: { kind: "event", label: "AgentOS" },
});

export function orchestratorConversation(start: number): ChatItem[] {
  let t = start;
  const at = (secs: number) => (t += secs * 1000);
  return [
    event("event-1", at(0), [
      "PR #88 (push-notifications): CI green",
      "PR #214 (idempotency-keys): opened",
    ]),
    {
      id: "assistant-1",
      createdAt: at(20),
      kind: "assistant",
      text: "Reviewed #88 at `4f2c9e1`: passes. CI settled, nothing blocked, the diff stays in the card's scope. Merged it.\n\nStarting the review of #214.",
    },
    { id: "turn-1", createdAt: at(1), kind: "turn_end", durationMs: 21000 },
    event("event-2", at(240), [
      "PR #214 (idempotency-keys): review passed",
      "PR #214 (idempotency-keys): changes .github/workflows/ci.yml",
    ]),
    {
      id: "assistant-2",
      createdAt: at(15),
      kind: "assistant",
      text: "#214 passes review and CI, but it edits the CI workflow, and merge approvals are on, so it waits for you. I've put it on your asks with the review summary.",
    },
    {
      id: "note-1",
      createdAt: at(1),
      kind: "note",
      tone: "ask",
      text: "Asked: Merge #214? It changes the CI workflow",
    },
    { id: "turn-2", createdAt: at(1), kind: "turn_end", durationMs: 17000 },
    event("event-3", at(300), [
      "flaky-cart-test: BLOCKED: needs a decision on retrying the cart suite in CI",
    ]),
    {
      id: "assistant-3",
      createdAt: at(12),
      kind: "assistant",
      text: "Told flaky-cart-test to fix the race rather than add retries, and to run the suite 20 times before calling it done. Started **order-export** from the board.",
    },
    { id: "turn-3", createdAt: at(1), kind: "turn_end", durationMs: 13000 },
  ];
}

export function orchestratorAsks(tasks: { idem: string }) {
  return [
    {
      subject: `task:${tasks.idem}`,
      kind: "gate",
      title: "Merge #214? It changes the CI workflow",
      detail:
        "Review passed and CI is green at 9c41d7a. It adds a step to .github/workflows/ci.yml that runs the idempotency suite against Postgres, so it needs your approval.",
      link: "https://github.com/example/payments-api/pull/214",
      sha: "9c41d7a0b3e2f5a8c1d4e7b0a3f6c9d2e5b8a1c4",
      minutesAgo: 12,
    },
    {
      subject: "title:announce changelog",
      kind: "public",
      title: "Post the March changelog to the docs site?",
      detail:
        "docs-site has the draft at changelog/2026-03.md. Publishing is public, so it's yours to say.",
      link: null,
      sha: null,
      minutesAgo: 30,
    },
  ];
}
