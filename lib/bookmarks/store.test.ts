import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { getDb, updateSessionRow } from "@/lib/db";
import type { ChatItem } from "@/lib/chat/events";
import { saveItem } from "@/lib/chat/store";
import {
  BookmarkError,
  bookmarksForMove,
  createBookmark,
  insertMovedBookmarks,
  listBookmarks,
  listSessionBookmarks,
  removeBookmark,
  setBookmarkNote,
} from "./store";
import { MAX_SNAPSHOT_CHARS } from "./types";

// Built at runtime: the merge gate refuses token-shaped literals.
const FAKE_KEY = "sk" + "-" + "abcdefghijklmnopqrstuvwxyz0123456789";

function workspace() {
  const id = randomUUID();
  getDb().prepare(`INSERT INTO workspaces (id, name) VALUES (?, 'W')`).run(id);
  return id;
}

function session(
  opts: { name?: string; workspace?: string; project?: string } = {}
) {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, workspace_id, project_id)
       VALUES (?, ?, ?, '/tmp', ?, ?)`
    )
    .run(
      id,
      opts.name ?? "chat",
      `claude-${id}`,
      opts.workspace ?? null,
      opts.project ?? null
    );
  return id;
}

function say(
  sessionId: string,
  item: Partial<ChatItem> & { kind: ChatItem["kind"] }
) {
  const full = { id: randomUUID(), createdAt: Date.now(), ...item } as ChatItem;
  saveItem(sessionId, full);
  return full.id;
}

// A chat with a turn: asked, a tool, an answer, the end.
function chat(opts: Parameters<typeof session>[0] = {}) {
  const s = session(opts);
  const user = say(s, { kind: "user", text: "why does the move test fail?" });
  const tool = say(s, {
    kind: "tool",
    name: "Bash",
    title: "Run tests",
    input: { command: "npx vitest" },
    status: "done",
    output: `OPENAI_API_KEY=${FAKE_KEY} printed`,
  } as Partial<ChatItem> & { kind: "tool" });
  const reply = say(s, {
    kind: "assistant",
    text: "TMPDIR is a symlink on CI.",
  });
  const reasoning = say(s, { kind: "reasoning", text: "hmm" });
  say(s, { kind: "turn_end" });
  return { s, user, tool, reply, reasoning };
}

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof BookmarkError ? err.status : "other";
  }
  return null;
};

describe("createBookmark", () => {
  it("is idempotent per item and scope, and an item can hold a turn too", () => {
    const c = chat();
    const a = createBookmark({ sessionId: c.s, itemId: c.user });
    expect(a.created).toBe(true);
    expect(a.bookmark.kind).toBe("user");
    const again = createBookmark({ sessionId: c.s, itemId: c.user });
    expect(again.created).toBe(false);
    expect(again.bookmark.id).toBe(a.bookmark.id);
    const turn = createBookmark({
      sessionId: c.s,
      itemId: c.user,
      scope: "turn",
    });
    expect(turn.created).toBe(true);
    expect(turn.bookmark.kind).toBe("turn");
    expect(turn.bookmark.text).toContain("why does the move test fail?");
    expect(turn.bookmark.text).toContain("TMPDIR is a symlink on CI.");
    expect(listSessionBookmarks(c.s)).toHaveLength(2);
  });

  it("refuses an unknown session or item, and what can't be bookmarked", () => {
    const c = chat();
    expect(
      refusal(() => createBookmark({ sessionId: randomUUID(), itemId: c.user }))
    ).toBe(404);
    expect(
      refusal(() => createBookmark({ sessionId: c.s, itemId: "nope" }))
    ).toBe(404);
    expect(
      refusal(() => createBookmark({ sessionId: c.s, itemId: c.reasoning }))
    ).toBe(400);
    expect(
      refusal(() =>
        createBookmark({ sessionId: c.s, itemId: c.reply, scope: "turn" })
      )
    ).toBe(400);
    expect(
      refusal(() =>
        createBookmark({ sessionId: c.s, itemId: c.user, scope: "x" })
      )
    ).toBe(400);
    expect(refusal(() => createBookmark({ sessionId: c.s }))).toBe(400);
  });

  it("masks a secret in a tool's output", () => {
    const c = chat();
    const { bookmark } = createBookmark({ sessionId: c.s, itemId: c.tool });
    expect(bookmark.kind).toBe("tool");
    expect(bookmark.text).toContain("Run tests");
    expect(bookmark.text).not.toContain(FAKE_KEY);
  });

  it("masks a secret the clip would split", () => {
    const s = session();
    const pad = "x".repeat(MAX_SNAPSHOT_CHARS - 20);
    const user = say(s, {
      kind: "user",
      text: `${pad} OPENAI_API_KEY=${FAKE_KEY}`,
    });
    const { bookmark } = createBookmark({ sessionId: s, itemId: user });
    expect(bookmark.text.length).toBeLessThanOrEqual(MAX_SNAPSHOT_CHARS + 1);
    expect(bookmark.text).not.toContain(FAKE_KEY.slice(0, 8));
  });

  it("skips a row that isn't an item when it looks for a turn's reply", () => {
    const s = session();
    const user = say(s, { kind: "user", text: "what broke?" });
    getDb()
      .prepare(
        `INSERT INTO chat_items (session_id, item_id, seq, data)
         VALUES (?, 'corrupt', (SELECT MAX(seq) + 1 FROM chat_items WHERE session_id = ?), 'null')`
      )
      .run(s, s);
    say(s, { kind: "assistant", text: "The realpath of TMPDIR." });
    const { bookmark } = createBookmark({
      sessionId: s,
      itemId: user,
      scope: "turn",
    });
    expect(bookmark.text).toContain("what broke?");
    expect(bookmark.text).toContain("The realpath of TMPDIR.");
  });

  it("takes the workspace from the project, or an orchestrator's own", () => {
    const ws = workspace();
    const project = randomUUID();
    getDb()
      .prepare(
        `INSERT INTO projects (id, name, working_directory, workspace_id) VALUES (?, 'P', '/tmp/p', ?)`
      )
      .run(project, ws);
    const viaProject = chat({ project });
    expect(
      createBookmark({ sessionId: viaProject.s, itemId: viaProject.user })
        .bookmark.workspaceId
    ).toBe(ws);
    const own = chat({ workspace: ws });
    expect(
      createBookmark({ sessionId: own.s, itemId: own.user }).bookmark
        .workspaceId
    ).toBe(ws);
  });
});

describe("listing", () => {
  it("lists a chat's bookmarks in chat order", () => {
    const c = chat();
    createBookmark({ sessionId: c.s, itemId: c.reply });
    createBookmark({ sessionId: c.s, itemId: c.user });
    createBookmark({ sessionId: c.s, itemId: c.tool });
    expect(listSessionBookmarks(c.s).map((b) => b.itemId)).toEqual([
      c.user,
      c.tool,
      c.reply,
    ]);
  });

  it("scopes to a workspace, searches text, note and name, escapes LIKE", () => {
    const ws = workspace();
    const a = chat({ workspace: ws, name: "fix flaky move test" });
    const b = chat({ workspace: workspace(), name: "elsewhere" });
    const x = createBookmark({ sessionId: a.s, itemId: a.reply }).bookmark;
    setBookmarkNote(x.id, "root cause 100%");
    createBookmark({ sessionId: b.s, itemId: b.reply });
    expect(listBookmarks({ workspace: ws }).bookmarks.map((r) => r.id)).toEqual(
      [x.id]
    );
    const ids = (q: string) =>
      listBookmarks({ workspace: ws, q }).bookmarks.map((r) => r.id);
    expect(ids("symlink")).toEqual([x.id]);
    expect(ids("root cause")).toEqual([x.id]);
    expect(ids("flaky")).toEqual([x.id]);
    expect(ids("100%")).toEqual([x.id]);
    expect(ids("1_0")).toEqual([]);
    expect(ids("root%100")).toEqual([]);
    expect(
      listBookmarks({ workspace: "all", q: "symlink" }).bookmarks.length
    ).toBeGreaterThanOrEqual(2);
  });

  it("pages by cursor, newest first", () => {
    const ws = workspace();
    const c = chat({ workspace: ws });
    for (const itemId of [c.user, c.tool, c.reply])
      createBookmark({ sessionId: c.s, itemId });
    const first = listBookmarks({ workspace: ws, limit: 2 });
    expect(first.bookmarks).toHaveLength(2);
    expect(first.next).not.toBeNull();
    const second = listBookmarks({
      workspace: ws,
      limit: 2,
      before: first.next,
    });
    expect(second.bookmarks).toHaveLength(1);
    expect(second.next).toBeNull();
    const all = [...first.bookmarks, ...second.bookmarks].map((b) => b.itemId);
    expect(new Set(all)).toEqual(new Set([c.user, c.tool, c.reply]));
  });

  it("keeps a deleted chat's bookmarks, and marks archived ones", () => {
    const c = chat();
    const b = createBookmark({ sessionId: c.s, itemId: c.reply }).bookmark;
    expect(b.state).toBe("live");
    getDb()
      .prepare(`UPDATE sessions SET archived_at = datetime('now') WHERE id = ?`)
      .run(c.s);
    expect(listSessionBookmarks(c.s)[0].state).toBe("archived");
    getDb().prepare(`DELETE FROM chat_items WHERE session_id = ?`).run(c.s);
    getDb().prepare(`DELETE FROM sessions WHERE id = ?`).run(c.s);
    const [gone] = listSessionBookmarks(c.s);
    expect(gone.state).toBe("deleted");
    expect(gone.text).toContain("TMPDIR");
    expect(gone.sessionName).toBe("chat");
  });
});

describe("notes and removal", () => {
  it("sets, trims and clears a note; removes once", () => {
    const c = chat();
    const b = createBookmark({
      sessionId: c.s,
      itemId: c.user,
      note: "  keep\nthis ",
    }).bookmark;
    expect(b.note).toBe("keep this");
    expect(setBookmarkNote(b.id, null)!.note).toBeNull();
    expect(setBookmarkNote(randomUUID(), "x")).toBeNull();
    expect(refusal(() => setBookmarkNote(b.id, 5))).toBe(400);
    expect(removeBookmark(b.id)).toBe(true);
    expect(removeBookmark(b.id)).toBe(false);
  });
});

describe("moves", () => {
  it("carries bookmarks to the arriving row and hides the copy left behind", () => {
    const ws = workspace();
    const c = chat({ workspace: ws, name: "moving" });
    createBookmark({ sessionId: c.s, itemId: c.reply, note: "n" });
    const rows = bookmarksForMove(c.s);
    updateSessionRow(getDb(), c.s, { task_status: "moved" });
    const arrived = session({ workspace: ws, name: "moving" });
    insertMovedBookmarks(arrived, rows);
    insertMovedBookmarks(arrived, rows);
    const there = listSessionBookmarks(arrived);
    expect(there).toHaveLength(1);
    expect(there[0]).toMatchObject({
      itemId: c.reply,
      note: "n",
      workspaceId: ws,
      state: "live",
    });
    expect(listSessionBookmarks(c.s)[0].state).toBe("moved");
    expect(
      listBookmarks({ workspace: ws }).bookmarks.map((b) => b.sessionId)
    ).toEqual([arrived]);
  });
});
