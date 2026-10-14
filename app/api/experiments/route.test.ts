import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { experimentOn } from "@/lib/experiments";
import { GET } from "./route";
import * as one from "./[id]/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (id: string, body: unknown) =>
  one.PUT(
    new NextRequest(`http://localhost/api/experiments/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
    ctx(id)
  );

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'experiments.%'`).run();
});

describe("/api/experiments", () => {
  it("lists every experiment, off, with zero usage", async () => {
    const body = await (await GET()).json();
    const e = body.experiments.find(
      (x: { id: string }) => x.id === "learning-cards"
    );
    expect(e).toMatchObject({ on: false, status: "experimental" });
    expect(e.usage.today.calls).toBe(0);
  });

  it("switches one on and off", async () => {
    expect((await put("learning-cards", { on: true })).status).toBe(200);
    expect(experimentOn("learning-cards")).toBe(true);
    await put("learning-cards", { on: false });
    expect(experimentOn("learning-cards")).toBe(false);
  });

  it("refuses an unknown id and a bad body", async () => {
    expect((await put("nope", { on: true })).status).toBe(404);
    expect((await put("learning-cards", { on: "yes" })).status).toBe(400);
  });

  it("gives the detail view", async () => {
    const res = await one.GET(
      new NextRequest("http://localhost/api/experiments/learning-cards"),
      ctx("learning-cards")
    );
    expect((await res.json()).detail.days).toHaveLength(30);
  });
});
