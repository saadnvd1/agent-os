import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import type { ChatItem } from "@/lib/chat/events";
import { deleteItems, flushItems, queueItem, saveItem } from "@/lib/chat/store";
import { backfillStep, indexProgress } from "./backfill";
import { createConversationSearch } from "./schema";
import { getMessageContext } from "./messageContext";
import { searchConversations } from "./searchConversations";

const id = () => randomUUID().slice(0, 8);

function chat(
  opts: { workspace?: string; project?: string; name?: string } = {}
) {
  const sid = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, workspace_id, project_id)
       VALUES (?, ?, ?, '/tmp', ?, ?)`
    )
    .run(
      sid,
      opts.name ?? "chat",
      `claude-${sid}`,
      opts.workspace ?? null,
      opts.project ?? null
    );
  return sid;
}
const say = (
  sid: string,
  kind: "user" | "assistant",
  text: string,
  itemId = id()
) => {
  saveItem(sid, { id: itemId, kind, text, createdAt: 1 } as ChatItem);
  return itemId;
};
const ids = (q: string, workspace = "all") =>
  searchConversations(q, { workspace }).groups.flatMap((g) =>
    g.hits.map((h) => h.itemId)
  );

describe("keeping the index current", () => {
  it("makes a new prompt and reply searchable at once", () => {
    const s = chat();
    const u = say(s, "user", "please explain zebrafinch migration");
    const a = say(s, "assistant", "zebrafinch pairs stay together");
    expect(ids("zebrafinch").sort()).toEqual([a, u].sort());
    expect(ids("zebrafin")).toHaveLength(2);
  });

  it("follows a streamed message as its text grows, with one row", () => {
    const s = chat();
    const m = say(s, "assistant", "quokk");
    say(s, "assistant", "quokka sunrise kettle", m);
    expect(ids("sunrise")).toEqual([m]);
    expect(ids("quokk")).toEqual([m]);
    say(s, "assistant", "final wording only", m);
    expect(ids("sunrise")).toEqual([]);
    expect(ids("wording")).toEqual([m]);
    const n = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM chat_search_keys WHERE session_id = ?`
      )
      .get(s) as { n: number };
    expect(n.n).toBe(1);
  });

  it("indexes writes through the streaming queue", () => {
    const s = chat();
    const m = id();
    queueItem(s, {
      id: m,
      kind: "assistant",
      text: "marmalade drift",
      createdAt: 1,
    } as ChatItem);
    flushItems();
    expect(ids("marmalade")).toEqual([m]);
  });

  it("leaves tool calls and empty messages out", () => {
    const s = chat();
    saveItem(s, {
      id: id(),
      kind: "tool",
      text: "ocelotword",
      createdAt: 1,
    } as unknown as ChatItem);
    say(s, "user", "");
    expect(ids("ocelotword")).toEqual([]);
  });

  it("forgets a deleted conversation", () => {
    const s = chat();
    say(s, "user", "pelicanbrief");
    expect(ids("pelicanbrief")).toHaveLength(1);
    deleteItems(s);
    expect(ids("pelicanbrief")).toEqual([]);
  });

  it("can have its schema created twice", () => {
    expect(() => createConversationSearch(getDb())).not.toThrow();
  });
});

describe("backfill", () => {
  function preexisting(words: string[]) {
    const db = getDb();
    const s = chat();
    // Rows from before the index: written with the triggers out of the way.
    db.exec(`DROP TRIGGER chat_search_ai`);
    const made = words.map((w) => say(s, "user", `${w} backlog`));
    createConversationSearch(db);
    return { s, made };
  }
  const reset = (to: number) =>
    getDb()
      .prepare(
        `UPDATE chat_search_state SET cursor = 0, done = 0, backfill_to = ? WHERE id = 1`
      )
      .run(to);
  const top = () =>
    (
      getDb().prepare(`SELECT MAX(rowid) AS m FROM chat_items`).get() as {
        m: number;
      }
    ).m;

  it("indexes what was there, in steps that can stop and resume", () => {
    const { made } = preexisting([
      "wombat1",
      "wombat2",
      "wombat3",
      "wombat4",
      "wombat5",
    ]);
    expect(ids("wombat1")).toEqual([]);
    reset(top());
    const db = getDb();
    expect(backfillStep(db, 2)).toBe(false);
    expect(indexProgress()).not.toBeNull();
    const partway = db
      .prepare(`SELECT cursor FROM chat_search_state`)
      .get() as { cursor: number };
    expect(partway.cursor).toBeGreaterThan(0);
    // "Restart": nothing but the stored state carries over.
    let guard = 0;
    while (!backfillStep(db, 2) && guard++ < 1000);
    expect(indexProgress()).toBeNull();
    for (const [i, m] of made.entries())
      expect(ids(`wombat${i + 1}`)).toEqual([m]);
  });

  it("does not index a message twice when it was also written live", () => {
    const { s } = preexisting(["lemur1"]);
    const live = say(s, "user", "lemur2 backlog");
    reset(top());
    const db = getDb();
    while (!backfillStep(db, 2));
    expect(ids("lemur2")).toEqual([live]);
    expect(ids("backlog").filter((x) => x === live)).toHaveLength(1);
  });

  it("starts over when the index version changed", () => {
    const s = chat();
    const m = say(s, "user", "narwhalpod");
    const db = getDb();
    db.prepare(`UPDATE chat_search_state SET version = 0, done = 1`).run();
    expect(indexProgress()).not.toBeNull();
    while (!backfillStep(db, 50));
    expect(ids("narwhalpod")).toEqual([m]);
    expect(indexProgress()).toBeNull();
  });
});

describe("message context", () => {
  it("returns the message with text around it, only user and assistant", () => {
    const s = chat();
    const a = say(s, "user", "one");
    say(s, "assistant", "two");
    saveItem(s, {
      id: id(),
      kind: "tool",
      createdAt: 1,
    } as unknown as ChatItem);
    const hit = say(s, "user", "three");
    say(s, "assistant", "four");
    const ctx = getMessageContext(s, hit, 2)!;
    expect(ctx.map((c) => c.text)).toEqual(["one", "two", "three", "four"]);
    expect(ctx.find((c) => c.hit)?.id).toBe(hit);
    expect(ctx[0].id).toBe(a);
    expect(getMessageContext(s, "nope")).toBeNull();
  });
});
