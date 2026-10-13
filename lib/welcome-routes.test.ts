import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { TRUST_HEADER } from "./security/auth";

const route = await import("@/app/api/welcome/route");

const req = (method = "GET", body?: unknown) =>
  new NextRequest("http://localhost/api/welcome", {
    method,
    headers: {
      [TRUST_HEADER]: "loopback",
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key = 'welcome.completed_at'`).run();
  db.prepare(`DELETE FROM sessions`).run();
  db.prepare(`DELETE FROM projects WHERE is_uncategorized = 0`).run();
});

describe("/api/welcome", () => {
  it("opens on a fresh install", async () => {
    const body = await (await route.GET()).json();
    expect(body).toMatchObject({ show: true, fresh: true });
  });

  it("stays shut once a project exists, and remembers it", async () => {
    db.prepare(
      `INSERT INTO projects (id, name, working_directory) VALUES ('wp', 'App', '/tmp/app')`
    ).run();
    expect(await (await route.GET()).json()).toMatchObject({ show: false });
    db.prepare(`DELETE FROM projects WHERE id = 'wp'`).run();
    expect(await (await route.GET()).json()).toMatchObject({
      show: false,
      completedAt: "existing-install",
    });
  });

  it("stops showing once setup is completed", async () => {
    const res = await route.POST(req("POST", { action: "complete" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ show: false });
    expect(await (await route.GET()).json()).toMatchObject({ show: false });
  });

  it("refuses an unknown action", async () => {
    expect((await route.POST(req("POST", { action: "reset" }))).status).toBe(
      400
    );
    expect((await route.POST(req("POST", {}))).status).toBe(400);
  });
});
