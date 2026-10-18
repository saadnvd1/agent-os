import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedWorkspace } from "./testing";

const mocks = vi.hoisted(() => ({
  sweepNow: vi.fn(async () => undefined),
  hostExec: vi.fn(async () => ({ stdout: "", stderr: "" })),
  hostApi: vi.fn(),
  remote: { armed: false, runs: [] as unknown[] },
}));
vi.mock("@/lib/worktree-sweep/start", async (orig) => ({
  ...(await orig<typeof import("@/lib/worktree-sweep/start")>()),
  sweepNow: mocks.sweepNow,
}));
vi.mock("@/lib/hosts", async (orig) => ({
  ...(await orig<typeof import("@/lib/hosts")>()),
  hostExec: mocks.hostExec,
}));
vi.mock("@/lib/hosts/remote-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/hosts/remote-api")>()),
  requireHostLink: (hostId: string) => ({
    hostId,
    hostName: "box",
    url: "http://devbox:3011",
    token: "t",
  }),
  hostApi: mocks.hostApi,
}));

const { db } = await import("@/lib/db");
const { createHost } = await import("@/lib/hosts");
const { ensureOrchestrator } = await import("./home");
const { runTool } = await import("./serve");
const { setPaused } = await import("./pause");
const { listNotes } = await import("./notes");
const { startRun, finishRun } = await import("@/lib/worktree-sweep/store");
const { reaperArmed, setReaperArmed } =
  await import("@/lib/worktree-sweep/settings");
const { dryRunVerdict, totalsLine } = await import("./sweep-arm");
const { POST } =
  await import("@/app/api/workspaces/[id]/orchestrator/tools/route");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-sweep-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

const summary = {
  removed: [],
  skipped: [],
  freedBytes: 0,
  pending: [1, 2].map((n) => ({
    path: `/x/${n}`,
    kind: "temp" as const,
    why: "old",
    bytes: 1024 ** 3,
  })),
};

function dryRun(minutesAgo = 5, error: string | null = null) {
  const id = startRun(true);
  finishRun(id, summary, error);
  db.prepare(
    `UPDATE worktree_sweep_runs SET finished_at = datetime('now', ?) WHERE id = ?`
  ).run(`-${minutesAgo} minutes`, id);
  return id;
}

function setup() {
  const ws = seedWorkspace();
  ensureOrchestrator(ws.workspace.id);
  return ws.workspace.id;
}

beforeEach(() => {
  db.prepare(`DELETE FROM worktree_sweep_runs`).run();
  setReaperArmed(false);
  mocks.hostExec.mockClear();
  mocks.hostApi.mockReset();
  mocks.sweepNow.mockClear();
});

const arm = (w: string, machine = "here", on = true) =>
  runTool(w, "sweep_arm", { machine, on, reason: "Saad said so on Oct 18" });

describe("dryRunVerdict", () => {
  const run = (over: object) =>
    ({
      id: 1,
      dryRun: true,
      finishedAt: "2026-10-18 12:00:00",
      error: null,
      ...over,
    }) as never;
  const now = Date.parse("2026-10-18T12:10:00Z");
  it("accepts one from the last hour", () => {
    expect(dryRunVerdict([run({})], "here", now).ok).toBe(true);
  });
  it("refuses none, running, failed and old ones, naming the dry run", () => {
    for (const runs of [
      [],
      [run({ dryRun: false })],
      [run({ finishedAt: null })],
      [run({ error: "boom" })],
      [run({ finishedAt: "2026-10-18 10:00:00" })],
    ]) {
      const v = dryRunVerdict(runs, "here", now);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.why).toMatch(/sweep_dry_run|still going/);
    }
  });
  it("lets the newest dry run decide", () => {
    const v = dryRunVerdict(
      [run({ id: 2, finishedAt: "2026-10-18 09:00:00" }), run({ id: 1 })],
      "here",
      now
    );
    expect(v.ok).toBe(false);
  });
  it("sums up the totals", () => {
    expect(
      totalsLine(
        run({
          details: { pendingTotal: { count: 2, bytes: 2 * 1024 ** 3 } },
        }),
        now
      )
    ).toMatch(/dry run #1 .*2 \(2.00 GB\) waiting/);
  });
});

describe("sweep_arm on this machine", () => {
  it("turns it on after a fresh dry run and logs it with the totals", async () => {
    const w = setup();
    const id = dryRun(10);
    const said = await arm(w);
    expect(reaperArmed()).toBe(true);
    expect(said).toMatch(/turned the full disk clean-up on for this machine/);
    const note = listNotes(w).find((n) => n.text.includes("clean-up on"));
    expect(note?.text).toContain("Saad said so on Oct 18");
    expect(note?.text).toContain(`dry run #${id}`);
    expect(note?.text).toContain("2.00 GB");
  });

  it("is refused without a dry run", async () => {
    const w = setup();
    await expect(arm(w)).rejects.toThrow(/sweep_dry_run/);
    expect(reaperArmed()).toBe(false);
    expect(listNotes(w).some((n) => n.text.includes("clean-up on"))).toBe(
      false
    );
  });

  it("is refused with a stale dry run", async () => {
    const w = setup();
    dryRun(120);
    await expect(arm(w)).rejects.toThrow(/must be from the last hour/);
    expect(reaperArmed()).toBe(false);
  });

  it("turns off without a dry run, even while paused; on is held by Pause", async () => {
    const w = setup();
    setReaperArmed(true);
    setPaused(w, true);
    await arm(w, "here", false);
    expect(reaperArmed()).toBe(false);
    expect(listNotes(w).some((n) => n.text.includes("clean-up off"))).toBe(
      true
    );
    dryRun();
    await expect(arm(w)).rejects.toThrow();
    expect(reaperArmed()).toBe(false);
  });

  it("starts a dry run", async () => {
    const w = setup();
    expect(await runTool(w, "sweep_dry_run", { machine: "here" })).toMatch(
      /Dry run started on this machine/
    );
    expect(mocks.sweepNow).toHaveBeenCalledWith(true);
  });
});

describe("sweep_arm on a linked machine", () => {
  const fresh = {
    id: 7,
    dryRun: true,
    finishedAt: new Date(Date.now() - 600000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " "),
    removed: 1,
    freedBytes: 0,
    skipped: 0,
    error: null,
    details: { ...summary, pendingTotal: { count: 2, bytes: 2 * 1024 ** 3 } },
  };
  const link = (runs: unknown[]) => {
    mocks.remote.armed = false;
    mocks.hostApi.mockImplementation(
      async (_l: unknown, p: string, o?: { body?: { armed?: boolean } }) => {
        if (o?.body && "armed" in o.body) mocks.remote.armed = o.body.armed!;
        return { armed: mocks.remote.armed, runs };
      }
    );
    mocks.hostExec.mockImplementation(async () => {
      mocks.remote.armed = true;
      return { stdout: "", stderr: "" };
    });
  };

  it("arms over ssh to its own loopback after its fresh dry run", async () => {
    const w = setup();
    createHost("box", "alice@devbox");
    link([fresh]);
    await arm(w, "box");
    expect(mocks.hostExec).toHaveBeenCalledTimes(1);
    const cmd = (mocks.hostExec.mock.calls as unknown as string[][])[0][1];
    expect(cmd).toContain("-X PUT");
    expect(cmd).toContain('"armed":true');
    expect(cmd).toContain("http://127.0.0.1:3011/api/worktree-sweep");
    expect(reaperArmed()).toBe(false);
    expect(listNotes(w)[0].text).toMatch(/on for box/);
  });

  it("does not arm on a stale remote dry run", async () => {
    const w = setup();
    createHost("box", "alice@devbox");
    link([{ ...fresh, finishedAt: "2026-10-18 01:00:00" }]);
    await expect(arm(w, "box")).rejects.toThrow(/last hour/);
    expect(mocks.hostExec).not.toHaveBeenCalled();
  });

  it("turns off through its API", async () => {
    const w = setup();
    createHost("box", "alice@devbox");
    link([fresh]);
    mocks.remote.armed = true;
    mocks.hostApi.mockImplementation(
      async (_l: unknown, _p: string, o?: { body?: { armed?: boolean } }) => {
        if (o?.body) mocks.remote.armed = false;
        return { armed: mocks.remote.armed, runs: [fresh] };
      }
    );
    // state read says armed (true) before the PUT
    await arm(w, "box", false);
    expect(mocks.hostApi).toHaveBeenCalledWith(
      expect.anything(),
      "/api/worktree-sweep",
      { method: "PUT", body: { armed: false } }
    );
  });
});

describe("only the orchestrator", () => {
  it("refuses the tools route without its token", async () => {
    const w = setup();
    dryRun();
    const call = (headers: Record<string, string>) =>
      POST(
        new NextRequest("http://x/api/workspaces/w/orchestrator/tools", {
          method: "POST",
          headers,
          body: JSON.stringify({
            tool: "sweep_arm",
            args: { machine: "here", on: true, reason: "x" },
          }),
        }),
        { params: Promise.resolve({ id: w }) }
      );
    expect((await call({})).status).toBe(403);
    expect((await call({ "x-agentos-orchestrator": "nope" })).status).toBe(403);
    expect(reaperArmed()).toBe(false);
  });
});
