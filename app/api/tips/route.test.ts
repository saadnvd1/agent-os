import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { putSetting } from "@/lib/settings-store";
import { GET, POST } from "./route";

beforeEach(() => {
  for (const k of ["tips.off", "tips.seen", "tips.today"]) putSetting(k, null);
});

const get = (q = "?day=2026-11-01", headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost/api/tips${q}`, { headers }));
const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/tips", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

describe("/api/tips", () => {
  it("returns today's tip and the deck, and 304s on the same ETag", async () => {
    const res = await get();
    const body = await res.json();
    expect(body.today.id).toEqual(expect.any(String));
    expect(body.deck.length).toBeGreaterThan(10);
    const again = await get("?day=2026-11-01", {
      "if-none-match": res.headers.get("etag")!,
    });
    expect(again.status).toBe(304);
  });

  it("rejects a bad day and a bad body", async () => {
    expect((await get("?day=tomorrow")).status).toBe(400);
    expect((await post({ action: "dance" })).status).toBe(400);
    expect((await post({ action: "seen", ids: ["a"], day: "x" })).status).toBe(
      400
    );
  });

  it("remembers a tip as read", async () => {
    const { today } = await (await get()).json();
    const after = await (
      await post({ action: "seen", ids: [today.id], day: "2026-11-01" })
    ).json();
    expect(after.today).toEqual({ id: today.id, read: true });
    expect((await (await get()).json()).today.read).toBe(true);
  });

  it("turns tips off and on", async () => {
    const off = await (await post({ action: "off", off: true })).json();
    expect(off).toMatchObject({ off: true, today: null, deck: [] });
    expect((await (await get()).json()).off).toBe(true);
    const on = await (await post({ action: "off", off: false })).json();
    expect(on.off).toBe(false);
  });
});
