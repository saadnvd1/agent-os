import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { TRUST_HEADER } from "@/lib/security/auth";
import { db } from "../db";
import { seedWorkspace } from "../orchestrator/testing";
import { ensureOrchestrator } from "../orchestrator/home";
import { buildDigest } from "../orchestrator/digest";
import * as route from "@/app/api/away/route";
import * as seenRoute from "@/app/api/away/seen/route";
import {
  activeAway,
  claimSweep,
  endAway,
  getAway,
  holdForBatch,
  isExpired,
  MAX_AWAY_MS,
  startAway,
  toSql,
} from "./state";
import {
  awayTick,
  notifyBatch,
  reportFile,
  turnAwayOff,
  turnAwayOn,
} from "./run";

const phone = vi.hoisted(() => [] as string[]);
vi.mock("../notify", () => ({
  notifyPhone: (_source: string, text: string) => phone.push(text),
}));

const audits = fs.mkdtempSync(path.join(os.tmpdir(), "away-audits-"));
process.env.AGENTOS_AUDITS_DIR = audits;

beforeEach(() => {
  // One period at a time, whatever the last test left on.
  db.exec(
    `UPDATE away_periods SET ended_at = datetime('now'), ended_by = 'saad' WHERE ended_at IS NULL`
  );
  phone.length = 0;
});

const MIN = 60 * 1000;

function events(workspaceId: string) {
  return db
    .prepare(
      `SELECT key, line FROM orchestrator_events WHERE workspace_id = ? ORDER BY id`
    )
    .all(workspaceId) as { key: string; line: string }[];
}

describe("Away's state", () => {
  it("starts once, moves its end, and ends once", () => {
    const now = Date.now();
    const a = startAway(
      { setBy: "this machine", expiresAt: now + 60 * MIN },
      now
    );
    expect(a.started).toBe(true);
    const b = startAway({ setBy: "phone", expiresAt: null }, now);
    expect(b.started).toBe(false);
    expect(b.row.id).toBe(a.row.id);
    expect(b.row.expires_at).toBeNull();
    expect(b.row.set_by).toBe("this machine");
    expect(endAway("saad", now)?.ended_by).toBe("saad");
    expect(endAway("saad", now)).toBeNull();
    expect(activeAway()).toBeNull();
  });

  it("refuses an end in the past or more than a week ahead", () => {
    const now = Date.now();
    expect(() => startAway({ setBy: "x", expiresAt: now - 1 }, now)).toThrow(
      /future/
    );
    expect(() =>
      startAway({ setBy: "x", expiresAt: now + MAX_AWAY_MS + MIN }, now)
    ).toThrow(/week/);
  });

  it("sweeps once per interval, whoever asks", () => {
    const now = Date.now();
    const { row } = startAway({ setBy: "x", expiresAt: null }, now);
    expect(claimSweep(row, 10 * MIN, now)).toBe(true);
    // The stale row (another caller) and the fresh one both lose.
    expect(claimSweep(row, 10 * MIN, now)).toBe(false);
    expect(claimSweep(getAway(row.id)!, 10 * MIN, now + MIN)).toBe(false);
    expect(claimSweep(getAway(row.id)!, 10 * MIN, now + 10 * MIN)).toBe(true);
  });
});

describe("turning Away on and off", () => {
  it("tells each orchestrator, leads its digest, and on return builds the report and tells his phone", () => {
    const w = seedWorkspace().workspace.id;
    ensureOrchestrator(w);
    const now = Date.now();
    const row = turnAwayOn(
      { setBy: "this machine", expiresAt: now + 4 * 60 * MIN },
      now
    );
    const on = events(w).find((e) => e.key === `once:away:${row.id}`);
    expect(on?.line).toMatch(/^Saad is away \(Away mode/);
    expect(on?.line).toMatch(/only ask them to wrap up, never drive them/);
    expect(on?.line).toMatch(/Hard lines still go to ask_saad/);
    expect(buildDigest(w)).toContain("Saad is away (Away mode");

    const off = turnAwayOff("saad", now + MIN);
    expect(off?.ended_by).toBe("saad");
    expect(events(w).some((e) => e.key === `once:back:${row.id}`)).toBe(true);
    expect(buildDigest(w)).not.toContain("Saad is away");
    expect(JSON.parse(getAway(row.id)!.report!).awayId).toBe(row.id);
    expect(fs.readFileSync(reportFile(getAway(row.id)!), "utf-8")).toContain(
      "# While you were away"
    );
    expect(
      path.relative(audits, reportFile(getAway(row.id)!)).startsWith("away/")
    ).toBe(true);
    expect(phone).toHaveLength(1);
    expect(phone[0]).toMatch(/^While you were away: /);
    // Already off: nothing more.
    expect(turnAwayOff("saad", now + 2 * MIN)).toBeNull();
    expect(phone).toHaveLength(1);
  });

  it("ends on its own when its time runs out, as of its expiry", () => {
    const now = Date.now();
    const row = turnAwayOn({ setBy: "x", expiresAt: now + 60 * MIN }, now);
    // Not run with a time before its expiry: that would start a sweep.
    expect(isExpired(getAway(row.id)!, now + 59 * MIN)).toBe(false);
    awayTick(now + 61 * MIN);
    const ended = getAway(row.id)!;
    expect(ended.ended_by).toBe("expired");
    expect(ended.ended_at).toBe(row.expires_at);
    expect(ended.report).toBeTruthy();
  });
});

describe("the batched phone notification", () => {
  it("sends the asks raised since the last batch as one message, then nothing until there's more", () => {
    const s = seedWorkspace();
    const w = s.workspace.id;
    const now = Date.now();
    const { row } = startAway({ setBy: "x", expiresAt: null }, now - 20 * MIN);
    const ask = (title: string, kind = "money") =>
      db
        .prepare(
          `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title, created_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run(w, `title:${title}`, kind, title, toSql(now - 5 * MIN));
    ask("Buy the domain");
    ask("Post the launch", "public");
    db.prepare(
      `INSERT INTO away_actions (away_id, workspace_id, subject, kind, key, detail, created_at) VALUES (?, ?, ?, 'deploy_failed', 'deploy:x', 'not deployed', ?)`
    ).run(row.id, w, s.task, toSql(now - 4 * MIN));

    const text = notifyBatch(getAway(row.id)!, now);
    expect(phone).toEqual([text]);
    expect(text).toMatch(/^While you're away: 2 new asks and 1 failed deploy/);
    expect(text).toContain("money: Buy the domain");
    expect(text).toContain("public: Post the launch");
    expect(text).toContain("deploy failed: not deployed");
    expect(notifyBatch(getAway(row.id)!, now + MIN)).toBeNull();
    expect(phone).toHaveLength(1);
  });

  it("holds an orchestrator's aos notify for the batch while away, and only then", async () => {
    const w = seedWorkspace().workspace.id;
    const orch = ensureOrchestrator(w);
    expect(holdForBatch(w, orch.id, "PR #9 needs your call")).toBe(false);
    const now = Date.now();
    const { row } = startAway({ setBy: "x", expiresAt: null }, now - MIN);
    const { notifyFrom } =
      await vi.importActual<typeof import("../notify")>("../notify");
    expect(await notifyFrom(orch.id, "PR #9 needs your call")).toMatchObject({
      state: "held",
    });
    const text = notifyBatch(getAway(row.id)!, now + MIN);
    expect(text).toMatch(/^While you're away: 1 note from an orchestrator/);
    expect(text).toContain("PR #9 needs your call");
  });
});

describe("the Away routes", () => {
  const req = (body?: object, trust = "loopback") =>
    new NextRequest("http://localhost:3011/api/away", {
      method: body ? "POST" : "GET",
      headers: {
        host: "localhost:3011",
        origin: "http://localhost:3011",
        "content-type": "application/json",
        [TRUST_HEADER]: trust,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  it("turns Away on and off only from a trusted place, and dismisses its report", async () => {
    const refused = await route.POST(
      req({ on: true, expiresAt: null }, "device")
    );
    expect(refused.status).toBe(403);
    expect(activeAway()).toBeNull();

    const bad = await route.POST(req({ on: true, expiresAt: "soon" }));
    expect(bad.status).toBe(400);

    const until = new Date(Date.now() + 60 * MIN).toISOString();
    const on = await (
      await route.POST(req({ on: true, expiresAt: until }))
    ).json();
    expect(on.away).toMatchObject({ setBy: "this machine" });
    expect(Date.parse(on.away.expiresAt)).toBeCloseTo(Date.parse(until), -4);

    const off = await (await route.POST(req({ on: false }))).json();
    expect(off.away).toBeNull();
    expect(off.report.awayId).toBe(on.away.id);

    const seen = await seenRoute.POST(req({ id: on.away.id }));
    expect(seen.status).toBe(200);
    expect((await route.GET().json()).report).toBeNull();
  });
});
