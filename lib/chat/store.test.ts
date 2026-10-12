import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import type { ChatItem } from "./events";

const {
  saveItem,
  listItems,
  lastItems,
  itemsOfKind,
  getItem,
  hasItem,
  queueItem,
  flushItems,
  moveToEnd,
  FLUSH_MS,
} = await import("./store");
const { getDb } = await import("@/lib/db");

function chat(): string {
  const id = randomUUID();
  const items: ChatItem[] = [
    { id: "u1", kind: "user", text: "go", createdAt: 1 },
    { id: "a1", kind: "assistant", text: "first", createdAt: 2 },
    {
      id: "t1",
      kind: "tool",
      name: "Bash",
      title: "ls",
      input: {},
      status: "done",
      createdAt: 3,
    },
    { id: "a2", kind: "assistant", text: "second", createdAt: 4 },
    { id: "u2", kind: "user", text: "more", createdAt: 5 },
    { id: "a3", kind: "assistant", text: "third", createdAt: 6 },
  ];
  for (const item of items) saveItem(id, item);
  return id;
}

const ids = (items: ChatItem[]) => items.map((i) => i.id);

describe("chat item queries", () => {
  it("lastItems is the tail of the conversation, oldest first", () => {
    const id = chat();
    expect(ids(lastItems(id, 3))).toEqual(ids(listItems(id).slice(-3)));
  });

  it("lastItems of a kind skips the others", () => {
    const id = chat();
    expect(ids(lastItems(id, 2, "assistant"))).toEqual(["a2", "a3"]);
  });

  it("itemsOfKind lists one kind in order, from this conversation only", () => {
    const id = chat();
    chat();
    expect(ids(itemsOfKind(id, "user"))).toEqual(["u1", "u2"]);
  });

  it("an item replaced in place keeps its position and its new kind data", () => {
    const id = chat();
    saveItem(id, { id: "a1", kind: "assistant", text: "edited", createdAt: 2 });
    expect(ids(lastItems(id, 10, "assistant"))).toEqual(["a1", "a2", "a3"]);
    expect(getItem(id, "a1")).toMatchObject({ text: "edited" });
    expect(hasItem(id, "a1")).toBe(true);
    expect(hasItem(id, "nope")).toBe(false);
  });
});

describe("chat_items kind index (migration 44)", () => {
  it("reads one kind from the index, not by scanning the conversation", async () => {
    const { getDb } = await import("@/lib/db");
    const plan = getDb()
      .prepare(
        `EXPLAIN QUERY PLAN SELECT data FROM chat_items
         WHERE session_id = ? AND kind = ? ORDER BY seq`
      )
      .all("s", "task") as { detail: string }[];
    expect(plan.map((p) => p.detail).join(" ")).toContain(
      "idx_chat_items_kind"
    );
  });
});

describe("batched writes", () => {
  // Rows written to chat_items, counted by the database itself.
  function countWrites(): () => number {
    const d = getDb();
    d.exec(`CREATE TEMP TABLE IF NOT EXISTS write_count (n INTEGER)`);
    d.exec(`DELETE FROM write_count`);
    d.exec(`INSERT INTO write_count VALUES (0)`);
    for (const ev of ["INSERT", "UPDATE"])
      d.exec(
        `CREATE TEMP TRIGGER IF NOT EXISTS count_${ev} AFTER ${ev} ON chat_items
         BEGIN UPDATE write_count SET n = n + 1; END`
      );
    return () =>
      (d.prepare(`SELECT n FROM write_count`).get() as { n: number }).n;
  }
  const raw = (id: string): ChatItem[] =>
    (
      getDb()
        .prepare(
          `SELECT data FROM chat_items WHERE session_id = ? ORDER BY seq`
        )
        .all(id) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  const streamed = (text: string): ChatItem => ({
    id: "a1",
    kind: "assistant",
    text,
    streaming: true,
    createdAt: 1,
  });

  it("writes a streamed item once per interval, not once per update", () => {
    vi.useFakeTimers();
    try {
      const id = randomUUID();
      const writes = countWrites();
      const N = 100;
      // 100 updates over 1000ms, 10ms apart.
      for (let i = 0; i < N; i++) {
        queueItem(id, streamed("x".repeat(i + 1)));
        vi.advanceTimersByTime(10);
      }
      vi.advanceTimersByTime(FLUSH_MS);
      expect(writes()).toBe(Math.ceil(1000 / FLUSH_MS));
      expect(raw(id)).toEqual([streamed("x".repeat(N))]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps first-seen order across items and across flushes", () => {
    const id = randomUUID();
    saveItem(id, { id: "u1", kind: "user", text: "go", createdAt: 1 });
    queueItem(id, streamed("a"));
    queueItem(id, {
      id: "t1",
      kind: "reasoning",
      text: "r",
      streaming: true,
      createdAt: 2,
    });
    queueItem(id, streamed("ab"));
    flushItems();
    queueItem(id, { id: "b1", kind: "assistant", text: "later", createdAt: 3 });
    queueItem(id, streamed("abc"), { flush: true });
    expect(listItems(id).map((i) => i.id)).toEqual(["u1", "a1", "t1", "b1"]);
    expect(getItem(id, "a1")).toMatchObject({ text: "abc" });
  });

  it("flushes on request and before a read, and keeps the position moveToEnd gives", () => {
    const id = randomUUID();
    queueItem(id, streamed("a"));
    expect(raw(id)).toEqual([]);
    expect(listItems(id)).toHaveLength(1);
    queueItem(id, { id: "b1", kind: "assistant", text: "b", createdAt: 2 });
    moveToEnd(id, "a1");
    queueItem(id, streamed("a!"));
    flushItems();
    expect(raw(id).map((i) => i.id)).toEqual(["b1", "a1"]);
  });

  it("writes a completed item at once", () => {
    const id = randomUUID();
    queueItem(
      id,
      { id: "t1", kind: "assistant", text: "done", createdAt: 1 },
      { flush: true }
    );
    expect(raw(id)).toHaveLength(1);
  });
});
