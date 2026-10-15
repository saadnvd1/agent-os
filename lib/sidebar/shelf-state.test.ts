import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { POST as snoozeRoute } from "@/app/api/sessions/[id]/snooze/route";
import { POST as settleRoute } from "@/app/api/sessions/[id]/settle/route";
import { touchActive } from "@/lib/session-activity";
import {
  reopenSession,
  settleSession,
  snoozeSession,
  unsnoozeSession,
} from "./shelf-state";

function insertSession(over: { active_at?: string | null } = {}): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, updated_at, active_at)
       VALUES (?, 's', ?, '2026-10-01 10:00:00', ?)`
    )
    .run(id, `claude-${id}`, over.active_at ?? null);
  return id;
}

const row = (id: string) =>
  getDb().prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as Record<
    string,
    string | null
  >;

const post =
  (route: typeof snoozeRoute) => (id: string, body: unknown, raw?: string) =>
    route(
      new Request("http://localhost/x", {
        method: "POST",
        body: raw ?? JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) }
    );
const snoozeCall = post(snoozeRoute);
const settleCall = post(settleRoute);

describe("settle, reopen, snooze, unsnooze", () => {
  it("settling clears a snooze, snoozing clears a settle, neither moves updated_at", () => {
    const id = insertSession();
    snoozeSession(id, new Date("2026-10-20T14:00:00Z"));
    expect(row(id).snoozed_until).toBe("2026-10-20 14:00:00");
    expect(row(id).snoozed_at).not.toBeNull();
    settleSession(id);
    expect(row(id).settled_at).not.toBeNull();
    expect(row(id).snoozed_until).toBeNull();
    expect(row(id).snoozed_at).toBeNull();
    snoozeSession(id, new Date("2026-10-20T14:00:00Z"));
    expect(row(id).settled_at).toBeNull();
    expect(row(id).updated_at).toBe("2026-10-01 10:00:00");
  });

  it("reopen and unsnooze count as activity", () => {
    const id = insertSession({ active_at: "2026-09-01 00:00:00" });
    settleSession(id);
    reopenSession(id);
    expect(row(id).settled_at).toBeNull();
    expect(row(id).active_at).not.toBe("2026-09-01 00:00:00");
    getDb()
      .prepare(
        `UPDATE sessions SET active_at = '2026-09-01 00:00:00' WHERE id = ?`
      )
      .run(id);
    snoozeSession(id, new Date(Date.now() + 3600_000));
    unsnoozeSession(id);
    expect(row(id).snoozed_until).toBeNull();
    expect(row(id).active_at).not.toBe("2026-09-01 00:00:00");
  });

  it("refuses an archived or unknown session", () => {
    const id = insertSession();
    getDb()
      .prepare(`UPDATE sessions SET archived_at = datetime('now') WHERE id = ?`)
      .run(id);
    expect(settleSession(id)).toBe(false);
    expect(snoozeSession(id, new Date())).toBe(false);
    expect(settleSession("nope")).toBe(false);
  });
});

describe("touchActive", () => {
  const ago = (s: number) =>
    getDb().prepare(`SELECT datetime('now', ?) AS t`).get(`-${s} seconds`) as {
      t: string;
    };
  const set = (id: string, col: string, t: string) =>
    getDb().prepare(`UPDATE sessions SET ${col} = ? WHERE id = ?`).run(t, id);

  it("writes when empty, skips within a minute", () => {
    const id = insertSession();
    touchActive(id);
    const first = row(id).active_at;
    expect(first).not.toBeNull();
    set(id, "active_at", ago(5).t);
    touchActive(id);
    expect(row(id).active_at).toBe(ago(5).t);
  });

  it("writes within the minute when it wakes a snooze or un-settles", () => {
    const id = insertSession();
    set(id, "active_at", ago(30).t);
    set(id, "snoozed_at", ago(10).t);
    touchActive(id);
    expect(row(id).active_at).not.toBe(ago(30).t);

    const other = insertSession();
    set(other, "active_at", ago(30).t);
    set(other, "settled_at", ago(10).t);
    touchActive(other);
    expect(row(other).active_at).not.toBe(ago(30).t);
  });
});

describe("routes", () => {
  it("snooze validates the time and the body", async () => {
    const id = insertSession();
    expect((await snoozeCall(id, {})).status).toBe(400);
    expect((await snoozeCall(id, null, "nope")).status).toBe(400);
    expect((await snoozeCall(id, { until: "soon" })).status).toBe(400);
    expect(
      (await snoozeCall(id, { until: "2020-01-01T00:00:00Z" })).status
    ).toBe(400);
    const far = new Date(Date.now() + 90 * 86400_000).toISOString();
    expect((await snoozeCall(id, { until: far })).status).toBe(400);
    const ok = new Date(Date.now() + 86400_000).toISOString();
    expect((await snoozeCall(id, { until: ok })).status).toBe(200);
    expect(row(id).snoozed_until).toBe(ok.slice(0, 19).replace("T", " "));
    expect((await snoozeCall(id, { until: null })).status).toBe(200);
    expect(row(id).snoozed_until).toBeNull();
    expect((await snoozeCall("nope", { until: null })).status).toBe(404);
  });

  it("settle takes a boolean", async () => {
    const id = insertSession();
    expect((await settleCall(id, { settled: "yes" })).status).toBe(400);
    expect((await settleCall(id, { settled: true })).status).toBe(200);
    expect(row(id).settled_at).not.toBeNull();
    expect((await settleCall(id, { settled: false })).status).toBe(200);
    expect(row(id).settled_at).toBeNull();
    expect((await settleCall("nope", { settled: true })).status).toBe(404);
  });
});
