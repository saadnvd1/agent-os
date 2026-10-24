import type { ChatItem } from "../../lib/chat/events";

const step = (
  n: number,
  start: number,
  title: string,
  status: "done" | "error" | "stopped",
  output?: string
): ChatItem => ({
  id: `tool-${n}`,
  createdAt: start + n * 4000,
  kind: "tool",
  name: "Bash",
  title,
  input: { command: title },
  status,
  output,
  endedAt: start + n * 4000 + 1500,
});

// A reachability check cut short: some steps answered, one failed, two
// never ran.
export function verifyConversation(start: number): ChatItem[] {
  return [
    {
      id: "user-1",
      createdAt: start,
      kind: "user",
      text: "Which services can you reach from here before you scope the sync job?",
    },
    {
      id: "assistant-1",
      createdAt: start + 2000,
      kind: "assistant",
      text: "Here's what I can verify is reachable from this box, before I scope:",
    },
    step(
      1,
      start,
      "curl -sI https://api.example.test/health",
      "done",
      "HTTP/2 200 \ncontent-type: application/json"
    ),
    step(
      2,
      start,
      "curl -sI https://billing.example.test/v1",
      "done",
      "HTTP/2 401 \nwww-authenticate: Bearer"
    ),
    step(
      3,
      start,
      "pg_isready -h db.internal",
      "error",
      "db.internal:5432 - no response\nExit code 2"
    ),
    step(4, start, "curl -sI https://search.example.test", "stopped"),
    step(5, start, "redis-cli -h cache.internal ping", "stopped"),
    {
      id: "turn-1",
      createdAt: start + 40000,
      kind: "turn_end",
      durationMs: 40000,
      interrupted: true,
    },
  ];
}
