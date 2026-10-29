import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { GET } from "./route";

const get = (query: string) =>
  GET(new NextRequest(`http://localhost/api/sessions/resolve?${query}`));

function insert(
  id: string,
  name: string,
  over: { archived?: boolean; created?: string } = {}
) {
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, created_at, archived_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      id,
      name,
      `claude-${id}`,
      over.created ?? "2026-10-01 10:00:00",
      over.archived ? "2026-10-02 10:00:00" : null
    );
}

// Prefixes no random uuid in the shared test database starts with.
const P = "fffe0001";
const Q = "fffe0002";

beforeEach(() => {
  getDb().prepare(`DELETE FROM sessions WHERE id LIKE 'fffe000%'`).run();
});

describe("GET /api/sessions/resolve", () => {
  it("resolves a short id, archived sessions included", async () => {
    const id = `${P}-1111-4111-8111-111111111111`;
    insert(id, "Web perf audit", { archived: true });
    const res = await get(`ref=${P}&slug=whatever`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id,
      name: "Web perf audit",
      archived: true,
    });
  });

  it("resolves a whole id", async () => {
    const id = randomUUID();
    insert(id, "Plain");
    const res = await get(`ref=${id}`);
    expect((await res.json()).id).toBe(id);
    getDb().prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  });

  it("breaks a prefix clash by slug, then by newest", async () => {
    const older = `${Q}-1111-4111-8111-111111111111`;
    const newer = `${Q}-2222-4222-8222-222222222222`;
    insert(older, "Fix login", { created: "2026-10-01 10:00:00" });
    insert(newer, "Ship docs", { created: "2026-10-03 10:00:00" });
    expect((await (await get(`ref=${Q}&slug=fix-login`)).json()).id).toBe(
      older
    );
    expect((await (await get(`ref=${Q}&slug=ship-docs`)).json()).id).toBe(
      newer
    );
    expect((await (await get(`ref=${Q}&slug=gone-name`)).json()).id).toBe(
      newer
    );
    expect((await (await get(`ref=${Q}`)).json()).id).toBe(newer);
  });

  it("is 404 for an unknown id and 400 for a malformed or short ref", async () => {
    expect((await get(`ref=fffe0009`)).status).toBe(404);
    for (const bad of ["", "ref=", "ref=fffe", "ref=fffe00", "ref=<script>"]) {
      expect((await get(bad)).status).toBe(400);
    }
  });
});
