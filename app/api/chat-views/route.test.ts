import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import * as one from "./[sessionId]/route";
import * as list from "./route";

const put = (sessionId: string, body: unknown, raw = false) =>
  one.PUT(
    new Request("http://x/api/chat-views/" + sessionId, {
      method: "PUT",
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId }) }
  );
const views = async () =>
  (await (await list.GET()).json()).views as {
    sessionId: string;
    itemId: string | null;
    offsetPx: number;
    atEnd: boolean;
    viewedAt: number;
  }[];

describe("/api/chat-views", () => {
  it("saves a position, keeps it when a chat is only opened, and lists newest first", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const res = await put(a, { itemId: "i1", offsetPx: 40, atEnd: false });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    await put(b, { viewed: true });
    await new Promise((r) => setTimeout(r, 5));
    await put(a, { viewed: true });
    const mine = (await views()).filter(
      (v) => v.sessionId === a || v.sessionId === b
    );
    expect(mine.map((v) => v.sessionId)).toEqual([a, b]);
    expect(mine[0]).toMatchObject({ itemId: "i1", offsetPx: 40, atEnd: false });
    expect(mine[1]).toMatchObject({ itemId: null, atEnd: true });
    expect(mine[0].viewedAt).toBeGreaterThan(mine[1].viewedAt);
  });

  it("keeps viewed_at when the reader left with things unseen below", async () => {
    const id = randomUUID();
    await put(id, { viewed: true });
    const first = (await views()).find((v) => v.sessionId === id)!.viewedAt;
    await new Promise((r) => setTimeout(r, 5));
    await put(id, { itemId: "i", offsetPx: 3, atEnd: false, advance: false });
    const kept = (await views()).find((v) => v.sessionId === id)!;
    expect(kept).toMatchObject({ itemId: "i", offsetPx: 3, atEnd: false });
    expect(kept.viewedAt).toBe(first);
  });

  it("refuses a bad body and a bad id", async () => {
    const id = randomUUID();
    expect((await put(id, { offsetPx: "x" })).status).toBe(400);
    expect((await put(id, "not json", true)).status).toBe(400);
    expect(
      (await put(id, { itemId: "", offsetPx: 0, atEnd: true })).status
    ).toBe(400);
    expect((await put("bad id!", { viewed: true })).status).toBe(400);
    expect((await put(id, { viewed: true, x: "y".repeat(5000) })).status).toBe(
      413
    );
  });

  it("is dropped with its chat", async () => {
    const id = randomUUID();
    getDb()
      .prepare(
        `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 'v', ?, '/tmp')`
      )
      .run(id, `claude-${id}`);
    await put(id, { viewed: true });
    expect((await views()).some((v) => v.sessionId === id)).toBe(true);
    getDb().prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    expect((await views()).some((v) => v.sessionId === id)).toBe(false);
  });
});
