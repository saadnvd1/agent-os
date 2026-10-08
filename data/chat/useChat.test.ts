import { describe, expect, it } from "vitest";
import type { ChatItem } from "@/lib/chat/events";
import { applyDeltas, joinPage, keptBodies, routeItem } from "./useChat";

const say = (id: string, text = ""): ChatItem => ({
  id,
  kind: "assistant",
  text,
  createdAt: 1,
});

describe("applyDeltas", () => {
  it("appends each item's text and keeps every other item's identity", () => {
    const items = [say("a", "x"), say("b", "hel"), say("c", "")];
    const next = applyDeltas(
      items,
      new Map([
        ["b", "lo"],
        ["c", "!"],
      ])
    );
    expect(next.map((i) => ("text" in i ? i.text : ""))).toEqual([
      "x",
      "hello",
      "!",
    ]);
    expect(next[0]).toBe(items[0]);
  });

  it("returns the same array when nothing matched", () => {
    const items = [say("a")];
    expect(applyDeltas(items, new Map([["zz", "x"]]))).toBe(items);
  });
});

describe("joinPage", () => {
  it("keeps older loaded items before a fresh page that overlaps them", () => {
    const prev = ["a", "b", "c", "d"].map((id) => say(id));
    const page = [say("c", "new"), say("e")];
    expect(joinPage(prev, page)?.map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
      "e",
    ]);
  });

  it("takes the page as it is when it doesn't overlap or starts the same", () => {
    expect(joinPage([say("a")], [say("x")])).toBeNull();
    expect(joinPage([say("a"), say("b")], [say("a")])).toBeNull();
    expect(joinPage([say("a")], [])).toBeNull();
  });
});

const task = (id: string, status: "running" | "completed"): ChatItem => ({
  id,
  kind: "task",
  taskId: id,
  description: id,
  status,
  createdAt: 1,
});

const tool = (id: string, status: "running" | "done"): ChatItem => ({
  id,
  kind: "tool",
  name: "Bash",
  title: id,
  input: {},
  status,
  createdAt: 1,
  deferred: true,
});

describe("routeItem", () => {
  it("updates an earlier background task where it's listed", () => {
    const items = [say("a")];
    const earlier = [task("t1", "running")];
    const r = routeItem(items, earlier, task("t1", "completed"));
    expect(r.items).toBe(items);
    expect(r.earlier).toEqual([task("t1", "completed")]);
  });

  it("appends a new item and replaces a loaded one in place", () => {
    const items = [say("a"), say("b")];
    const earlier: ChatItem[] = [];
    expect(routeItem(items, earlier, say("c")).items.map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    const r = routeItem(items, earlier, say("a", "new"));
    expect(r.items.map((i) => ("text" in i ? i.text : ""))).toEqual([
      "new",
      "",
    ]);
    expect(r.earlier).toBe(earlier);
  });
});

describe("keptBodies", () => {
  const body = { output: "ok" };
  it("keeps finished tools' bodies and drops ones that may have changed", () => {
    const before = [
      tool("done", "done"),
      tool("was-running", "running"),
      tool("still", "running"),
    ];
    const page = [
      tool("done", "done"),
      tool("was-running", "done"),
      tool("still", "running"),
    ];
    const bodies = {
      done: body,
      "was-running": body,
      still: body,
      older: body,
      missing: null,
    };
    expect(keptBodies(bodies, before, page)).toEqual({
      done: body,
      older: body,
    });
  });
});
