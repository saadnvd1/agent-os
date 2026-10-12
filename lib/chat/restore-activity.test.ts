import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import type { ChatItem } from "./events";

const { saveItem, runningItems } = await import("./store");
const { restoreActivity } = await import("./activity");
const { PAGE_ITEMS } = await import("./page");
const { getDb } = await import("@/lib/db");

function chat(extra: ChatItem[] = []): string {
  const id = randomUUID();
  const old: ChatItem[] = [
    {
      id: "tool-old",
      kind: "tool",
      name: "Bash",
      title: "npm test",
      input: {},
      status: "running",
      createdAt: 1,
    },
    {
      id: "task-old",
      kind: "task",
      taskId: "t1",
      description: "a shell",
      status: "running",
      createdAt: 1,
    } as ChatItem,
    ...extra,
    { id: "u1", kind: "user", text: "go", createdAt: 5 },
  ];
  for (const item of old) saveItem(id, item);
  for (let i = 0; i < PAGE_ITEMS + 2000; i++)
    saveItem(id, {
      id: `a${i}`,
      kind: "assistant",
      text: "x",
      createdAt: 10 + i,
    });
  return id;
}

describe("restoreActivity", () => {
  it("finds a running tool and task older than the latest page", () => {
    const id = chat();
    const a = restoreActivity(id, "running");
    expect([...a.tools.keys()]).toEqual(["tool-old"]);
    expect([...a.tasks]).toEqual(["t1"]);
    expect(a.turnStartedAt).toBe(5);
    expect(a.lastWhat).toBe("writing a reply");
    expect(a.lastAt).toBe(10 + PAGE_ITEMS + 1999);
  });

  it("reads only a few rows of a long chat", () => {
    const id = chat();
    const parse = vi.spyOn(JSON, "parse");
    restoreActivity(id, "running");
    const parsed = parse.mock.calls.length;
    parse.mockRestore();
    expect(parsed).toBeLessThan(10);
  });

  it("restores no tools for an idle chat, and skips ambient tasks", () => {
    const id = chat([
      {
        id: "task-ambient",
        kind: "task",
        taskId: "t2",
        description: "watch",
        status: "running",
        ambient: true,
        createdAt: 2,
      } as ChatItem,
    ]);
    const a = restoreActivity(id, "idle");
    expect(a.tools.size).toBe(0);
    expect([...a.tasks]).toEqual(["t1"]);
  });

  it("looks running items up by the running index", () => {
    const id = chat();
    expect(runningItems(id, "tool").map((i) => i.id)).toEqual(["tool-old"]);
    const plan = getDb()
      .prepare(
        `EXPLAIN QUERY PLAN SELECT data FROM chat_items WHERE session_id = ?
         AND kind = ? AND json_extract(data, '$.status') = 'running' ORDER BY seq`
      )
      .all(id, "tool")
      .map((r) => (r as { detail: string }).detail)
      .join(" ");
    expect(plan).toContain("idx_chat_items_running");
  });
});
