import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import type { ChatItem } from "@/lib/chat/events";
import { saveItem } from "@/lib/chat/store";
import * as route from "./route";
import * as contextRoute from "./context/route";

const get = (qs: Record<string, string>) =>
  route.GET(
    new Request(
      `http://localhost/api/search/conversations?${new URLSearchParams(qs)}`
    )
  );

function setup() {
  const db = getDb();
  const tag = randomUUID().slice(0, 6);
  const ws = (n: string) => {
    const id = `ws-${tag}-${n}`;
    db.prepare(`INSERT INTO workspaces (id, name) VALUES (?, ?)`).run(
      id,
      `Space ${n}`
    );
    return id;
  };
  const a = ws("a");
  const b = ws("b");
  const proj = (n: string, w: string) => {
    const id = `p-${tag}-${n}`;
    db.prepare(
      `INSERT INTO projects (id, name, working_directory, workspace_id) VALUES (?, ?, '/tmp/x', ?)`
    ).run(id, `Proj ${n}`, w);
    return id;
  };
  const pa = proj("a", a);
  const pb = proj("b", b);
  const chat = (
    name: string,
    project: string | null,
    ws: string | null,
    text: string,
    archived = false
  ) => {
    const sid = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id, workspace_id, archived_at)
       VALUES (?, ?, ?, '/tmp', ?, ?, ?)`
    ).run(
      sid,
      name,
      `claude-${sid}`,
      project,
      ws,
      archived ? "2026-01-01" : null
    );
    for (let i = 0; i < 5; i++)
      saveItem(sid, {
        id: `${sid}-${i}`,
        kind: i % 2 ? "assistant" : "user",
        text: `${text} ${i}`,
        createdAt: 1,
      } as ChatItem);
    return sid;
  };
  return { a, b, pa, pb, chat, word: `lynx${tag}` };
}

describe("GET /api/search/conversations", () => {
  it("scopes to a workspace, all of them, or a project", async () => {
    const { a, b, pa, chat, word } = setup();
    const inA = chat("in a", pa, null, word);
    const direct = chat("direct", null, a, word);
    chat("in b", `p-${word.slice(4)}-b`, null, word);
    const only = async (qs: Record<string, string>) =>
      (
        (await (await get({ q: word, ...qs })).json()).groups as {
          sessionId: string;
        }[]
      )
        .map((g) => g.sessionId)
        .sort();
    expect(await only({ workspace: a })).toEqual([inA, direct].sort());
    expect((await only({ workspace: "all" })).length).toBe(3);
    expect(await only({ workspace: "all", project: pa })).toEqual([inA]);
    expect(await only({ workspace: b })).toHaveLength(1);
  });

  it("includes archived conversations and labels them, with the match marked", async () => {
    const { chat, word } = setup();
    chat("old", null, null, `${word} cleanup`, true);
    const body = await (await get({ q: word.slice(0, -1) })).json();
    expect(body.groups).toHaveLength(1);
    const g = body.groups[0];
    expect(g.status).toBe("archived");
    expect(g.hits.length).toBeLessThanOrEqual(3);
    expect(g.hits[0].snippet.some((s: { hit: boolean }) => s.hit)).toBe(true);
    expect(body.terms).toEqual([word.slice(0, -1)]);
  });

  it("rejects bad input and treats short queries as empty", async () => {
    expect((await get({ q: "x", limit: "999" })).status).toBe(400);
    expect((await get({ q: "x".repeat(300) })).status).toBe(400);
    const r = await get({ q: "a" });
    expect((await r.json()).groups).toEqual([]);
  });

  it("answers hostile query text with results, not an error", async () => {
    const r = await get({ q: '"AND" OR NEAR( * ^ col: "' });
    expect(r.status).toBe(200);
  });

  it("only reads", () => {
    expect(Object.keys(route).sort()).toEqual(["GET"]);
    expect(Object.keys(contextRoute).sort()).toEqual(["GET"]);
  });

  it("serves a message with its neighbours, and 404s a missing one", async () => {
    const { chat, word } = setup();
    const sid = chat("ctx", null, null, word);
    const ok = await contextRoute.GET(
      new Request(
        `http://localhost/x?${new URLSearchParams({ session: sid, item: `${sid}-2`, around: "1" })}`
      )
    );
    const items = (await ok.json()).items as { id: string; hit: boolean }[];
    expect(items.map((i) => i.id)).toEqual([
      `${sid}-1`,
      `${sid}-2`,
      `${sid}-3`,
    ]);
    const missing = await contextRoute.GET(
      new Request(
        `http://localhost/x?${new URLSearchParams({ session: sid, item: "nope" })}`
      )
    );
    expect(missing.status).toBe(404);
  });
});
