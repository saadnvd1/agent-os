import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import type { ChatItem } from "@/lib/chat/events";
import { saveItem } from "@/lib/chat/store";
import { MAX_BOOKMARK_BODY_BYTES } from "@/lib/bookmarks/body";
import * as sessionRoute from "../sessions/[id]/bookmarks/route";
import * as oneRoute from "./[id]/route";
import * as listRoute from "./route";

function chat() {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 'routes', ?, '/tmp')`
    )
    .run(id, `claude-${id}`);
  const item = (i: object) => {
    const full = { id: randomUUID(), createdAt: 1, ...i } as ChatItem;
    saveItem(id, full);
    return full.id;
  };
  return {
    id,
    user: item({ kind: "user", text: "find the albatross" }),
    reasoning: item({ kind: "reasoning", text: "thinking" }),
  };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown, raw?: string) =>
  new Request("http://localhost/x", {
    method: "POST",
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
const post = (id: string, body?: unknown, raw?: string) =>
  sessionRoute.POST(req(body, raw), ctx(id));

describe("bookmark routes", () => {
  it("creates (201), returns the same one again (200), lists it", async () => {
    const c = chat();
    const made = await post(c.id, { itemId: c.user });
    expect(made.status).toBe(201);
    const { bookmark } = await made.json();
    const again = await post(c.id, { itemId: c.user });
    expect(again.status).toBe(200);
    expect((await again.json()).bookmark.id).toBe(bookmark.id);
    const list = await sessionRoute.GET(req(), ctx(c.id));
    expect(
      (await list.json()).bookmarks.map((b: { id: string }) => b.id)
    ).toEqual([bookmark.id]);
    const all = await listRoute.GET(
      new Request("http://localhost/api/bookmarks?workspace=all&q=albatross")
    );
    expect((await all.json()).bookmarks[0].id).toBe(bookmark.id);
  });

  it("refuses a bad body (400) and what isn't there (404)", async () => {
    const c = chat();
    expect((await post(c.id, undefined, "not json")).status).toBe(400);
    expect((await post(c.id, {})).status).toBe(400);
    expect((await post(c.id, { itemId: c.reasoning })).status).toBe(400);
    expect((await post(c.id, { itemId: c.user, scope: "x" })).status).toBe(400);
    expect((await post(c.id, { itemId: "missing" })).status).toBe(404);
    expect((await post(randomUUID(), { itemId: c.user })).status).toBe(404);
  });

  it("refuses a body past its cap (413) on POST and PATCH", async () => {
    const c = chat();
    const huge = { itemId: c.user, note: "x".repeat(MAX_BOOKMARK_BODY_BYTES) };
    expect((await post(c.id, huge)).status).toBe(413);
    const { bookmark } = await (await post(c.id, { itemId: c.user })).json();
    const patched = await oneRoute.PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        body: JSON.stringify({ note: "x".repeat(MAX_BOOKMARK_BODY_BYTES) }),
      }),
      ctx(bookmark.id)
    );
    expect(patched.status).toBe(413);
  });

  it("sets a note, deletes once, and 404s a missing id", async () => {
    const c = chat();
    const { bookmark } = await (await post(c.id, { itemId: c.user })).json();
    const patch = (id: string, body: unknown) =>
      oneRoute.PATCH(
        new Request("http://localhost/x", {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
        ctx(id)
      );
    const noted = await patch(bookmark.id, { note: "seabird" });
    expect((await noted.json()).bookmark.note).toBe("seabird");
    expect((await patch(bookmark.id, {})).status).toBe(400);
    expect((await patch(bookmark.id, { note: 3 })).status).toBe(400);
    expect((await patch(randomUUID(), { note: "x" })).status).toBe(404);
    const del = () => oneRoute.DELETE(req(), ctx(bookmark.id));
    expect((await del()).status).toBe(200);
    expect((await del()).status).toBe(404);
  });
});
