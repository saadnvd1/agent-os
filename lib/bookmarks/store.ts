/**
 * Bookmarks: a person's "come back to this" marks on single chat items,
 * keyed by the item's stable id. Each keeps a redacted snapshot of what it
 * marks, so it can be searched and still reads after the chat is gone.
 */

import { randomUUID } from "crypto";
import { db, type Session } from "../db";
import type { ChatItem } from "../chat/events";
import { getItem } from "../chat/store";
import { getProject } from "../projects";
import { snapshotText } from "./snapshot";
import {
  BOOKMARKABLE_KINDS,
  MAX_NOTE_CHARS,
  type Bookmark,
  type BookmarkKind,
  type BookmarkScope,
  type BookmarksPage,
} from "./types";

// An orchestrator's own workspace, or its project's (as sessionWorkspace in
// lib/schedules/store, without pulling the scheduler into a move).
const sessionWorkspace = (s: Session): string | null =>
  s.workspace_id ??
  (s.project_id ? (getProject(s.project_id)?.workspace_id ?? null) : null);

/** A refusal the routes turn into its status. */
export class BookmarkError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404
  ) {
    super(message);
  }
}

interface Row {
  id: string;
  session_id: string;
  item_id: string;
  scope: BookmarkScope;
  workspace_id: string | null;
  kind: BookmarkKind;
  text: string;
  session_name: string;
  note: string | null;
  created_at: string;
}

type Joined = Row & {
  s_id: string | null;
  task_status: string | null;
  archived_at: string | null;
};

// The bookmark with its chat's state as of now.
const SELECT = `
  SELECT b.*, s.id AS s_id, s.task_status, s.archived_at
  FROM chat_bookmarks b LEFT JOIN sessions s ON s.id = b.session_id`;

function toBookmark(r: Joined): Bookmark {
  return {
    id: r.id,
    sessionId: r.session_id,
    itemId: r.item_id,
    scope: r.scope,
    kind: r.kind,
    text: r.text,
    note: r.note,
    sessionName: r.session_name,
    workspaceId: r.workspace_id,
    createdAt: r.created_at,
    state: !r.s_id
      ? "deleted"
      : r.task_status === "moved"
        ? "moved"
        : r.archived_at
          ? "archived"
          : "live",
  };
}

export function getBookmark(id: string): Bookmark | null {
  const r = db.prepare(`${SELECT} WHERE b.id = ?`).get(id) as
    | Joined
    | undefined;
  return r ? toBookmark(r) : null;
}

const cleanNote = (note: unknown): string | null => {
  if (note === null || note === undefined) return null;
  if (typeof note !== "string") throw new BookmarkError("Bad note", 400);
  const t = note.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_CHARS);
  return t || null;
};

// The first reply in the turn a user item starts, for its excerpt.
function firstReply(
  sessionId: string,
  userItemId: string
): ChatItem | undefined {
  const rows = db
    .prepare(
      `SELECT data FROM chat_items
       WHERE session_id = ? AND seq > (
         SELECT seq FROM chat_items WHERE session_id = ? AND item_id = ?)
       ORDER BY seq LIMIT 200`
    )
    .all(sessionId, sessionId, userItemId) as { data: string }[];
  for (const r of rows) {
    const item = JSON.parse(r.data) as ChatItem;
    if (item.kind === "user" || item.kind === "turn_end") return undefined;
    if (item.kind === "assistant" && item.text.trim()) return item;
  }
  return undefined;
}

/**
 * Marks an item. Idempotent: the same item and scope again returns the
 * bookmark it already has, with `created: false`.
 */
export function createBookmark(input: {
  sessionId: string;
  itemId?: unknown;
  scope?: unknown;
  note?: unknown;
}): { bookmark: Bookmark; created: boolean } {
  const { sessionId } = input;
  if (typeof input.itemId !== "string" || !input.itemId)
    throw new BookmarkError("itemId is required", 400);
  const scope = input.scope ?? "item";
  if (scope !== "item" && scope !== "turn")
    throw new BookmarkError("scope must be 'item' or 'turn'", 400);
  const note = cleanNote(input.note);
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(sessionId) as Session | undefined;
  if (!session) throw new BookmarkError("Session not found", 404);
  const existing = db
    .prepare(
      `SELECT id FROM chat_bookmarks WHERE session_id = ? AND item_id = ? AND scope = ?`
    )
    .get(sessionId, input.itemId, scope) as { id: string } | undefined;
  if (existing) return { bookmark: getBookmark(existing.id)!, created: false };
  const item = getItem(sessionId, input.itemId);
  if (!item) throw new BookmarkError("Message not found", 404);
  if (!(BOOKMARKABLE_KINDS as readonly string[]).includes(item.kind))
    throw new BookmarkError("That can't be bookmarked", 400);
  if (scope === "turn" && item.kind !== "user")
    throw new BookmarkError("A turn is bookmarked by its first message", 400);
  const kind = (scope === "turn" ? "turn" : item.kind) as BookmarkKind;
  const text = snapshotText(
    item,
    scope === "turn" ? firstReply(sessionId, item.id) : undefined
  );
  const id = randomUUID();
  db.prepare(
    `INSERT INTO chat_bookmarks
       (id, session_id, item_id, scope, workspace_id, kind, text, session_name, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (session_id, item_id, scope) DO NOTHING`
  ).run(
    id,
    sessionId,
    item.id,
    scope,
    sessionWorkspace(session),
    kind,
    text,
    session.name,
    note
  );
  // A request that raced this one may have made it first.
  const made = db
    .prepare(
      `SELECT id FROM chat_bookmarks WHERE session_id = ? AND item_id = ? AND scope = ?`
    )
    .get(sessionId, item.id, scope) as { id: string };
  return { bookmark: getBookmark(made.id)!, created: made.id === id };
}

/** One chat's bookmarks, in the order they appear in it. */
export function listSessionBookmarks(sessionId: string): Bookmark[] {
  return (
    db
      .prepare(
        `${SELECT}
         LEFT JOIN chat_items c ON c.session_id = b.session_id AND c.item_id = b.item_id
         WHERE b.session_id = ?
         ORDER BY c.seq IS NULL, c.seq, b.created_at, b.id`
      )
      .all(sessionId) as Joined[]
  ).map(toBookmark);
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const cursorOf = (b: Bookmark) => `${b.createdAt}|${b.id}`;

/**
 * Bookmarks across chats, newest first: one workspace's (null: those with
 * none) or every one's, matching `q` in the text, the note or the chat's
 * name. The copy a move left behind isn't listed: its live twin is.
 */
export function listBookmarks(opts: {
  workspace: string | null | "all";
  q?: string;
  before?: string | null;
  limit?: number;
}): BookmarksPage {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where = [`(s.task_status IS NULL OR s.task_status != 'moved')`];
  const args: (string | number)[] = [];
  if (opts.workspace === null) where.push(`b.workspace_id IS NULL`);
  else if (opts.workspace !== "all") {
    where.push(`b.workspace_id = ?`);
    args.push(opts.workspace);
  }
  const q = opts.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      `(b.text LIKE ? ESCAPE '\\' OR b.note LIKE ? ESCAPE '\\' OR b.session_name LIKE ? ESCAPE '\\')`
    );
    args.push(like, like, like);
  }
  if (opts.before) {
    const at = opts.before.lastIndexOf("|");
    if (at > 0) {
      where.push(`(b.created_at < ? OR (b.created_at = ? AND b.id < ?))`);
      const created = opts.before.slice(0, at);
      args.push(created, created, opts.before.slice(at + 1));
    }
  }
  const rows = (
    db
      .prepare(
        `${SELECT} WHERE ${where.join(" AND ")}
         ORDER BY b.created_at DESC, b.id DESC LIMIT ?`
      )
      .all(...args, limit + 1) as Joined[]
  ).map(toBookmark);
  const more = rows.length > limit;
  const bookmarks = more ? rows.slice(0, limit) : rows;
  return {
    bookmarks,
    next: more ? cursorOf(bookmarks[bookmarks.length - 1]) : null,
  };
}

export function setBookmarkNote(id: string, note: unknown): Bookmark | null {
  const clean = cleanNote(note);
  const changed = db
    .prepare(`UPDATE chat_bookmarks SET note = ? WHERE id = ?`)
    .run(clean, id).changes;
  return changed ? getBookmark(id) : null;
}

export function removeBookmark(id: string): boolean {
  return (
    db.prepare(`DELETE FROM chat_bookmarks WHERE id = ?`).run(id).changes > 0
  );
}

/** What a move carries: the chat's bookmarks, as stored. */
export interface MovedBookmark {
  itemId: string;
  scope: BookmarkScope;
  kind: BookmarkKind;
  text: string;
  note: string | null;
  createdAt: string;
}

export function bookmarksForMove(sessionId: string): MovedBookmark[] {
  return (
    db
      .prepare(
        `SELECT item_id, scope, kind, text, note, created_at
         FROM chat_bookmarks WHERE session_id = ? ORDER BY created_at, id`
      )
      .all(sessionId) as Row[]
  ).map((r) => ({
    itemId: r.item_id,
    scope: r.scope,
    kind: r.kind,
    text: r.text,
    note: r.note,
    createdAt: r.created_at,
  }));
}

/**
 * Writes a moved chat's bookmarks under the row it arrived as, scoped to
 * that row's workspace here. Run inside the transaction that makes the row.
 */
export function insertMovedBookmarks(
  sessionId: string,
  rows: MovedBookmark[]
): void {
  if (!rows.length) return;
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(sessionId) as Session | undefined;
  if (!session) return;
  const workspace = sessionWorkspace(session);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO chat_bookmarks
       (id, session_id, item_id, scope, workspace_id, kind, text, session_name, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of rows)
    insert.run(
      randomUUID(),
      sessionId,
      r.itemId,
      r.scope,
      workspace,
      r.kind,
      r.text,
      session.name,
      r.note,
      r.createdAt
    );
}
