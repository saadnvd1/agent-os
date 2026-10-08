import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";

const { saveItem, listItems, lastItems, itemsOfKind, getItem, hasItem } =
  await import("./store");

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
