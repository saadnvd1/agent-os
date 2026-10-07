import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { POST } from "@/app/api/sessions/[id]/pin/route";
import { setPinned } from "./pin";

function insertSession(): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, updated_at) VALUES (?, 'p', ?, '2026-10-01 10:00:00')`
    )
    .run(id, `claude-${id}`);
  return id;
}

const row = (id: string) =>
  getDb()
    .prepare(`SELECT pinned, updated_at FROM sessions WHERE id = ?`)
    .get(id) as { pinned: number; updated_at: string };

const call = (id: string, body?: string) =>
  POST(
    new Request(`http://localhost/api/sessions/${id}/pin`, {
      method: "POST",
      body,
    }),
    { params: Promise.resolve({ id }) }
  );

describe("setPinned", () => {
  it("pins and unpins without moving updated_at", () => {
    const id = insertSession();
    expect(setPinned(id, true)).toBe(true);
    expect(row(id)).toEqual({ pinned: 1, updated_at: "2026-10-01 10:00:00" });
    setPinned(id, false);
    expect(row(id).pinned).toBe(0);
  });

  it("reports an unknown session", () => {
    expect(setPinned("missing", true)).toBe(false);
  });
});

describe("POST /api/sessions/:id/pin", () => {
  it("refuses a body without a boolean", async () => {
    const id = insertSession();
    expect((await call(id, JSON.stringify({ pinned: "yes" }))).status).toBe(
      400
    );
    expect((await call(id)).status).toBe(400);
    expect(row(id).pinned).toBe(0);
  });

  it("404s an unknown session and pins a known one", async () => {
    expect(
      (await call("missing", JSON.stringify({ pinned: true }))).status
    ).toBe(404);
    const id = insertSession();
    expect((await call(id, JSON.stringify({ pinned: true }))).status).toBe(200);
    expect(row(id).pinned).toBe(1);
  });
});
