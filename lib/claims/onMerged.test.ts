import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { setPr } from "@/lib/db/session-parts";
import { seedSession, seedWorkspace } from "@/lib/orchestrator/testing";
import { machineId } from "./machine";
import { notifyOverlaps } from "./notifyOverlaps";
import { handleMerged, type MergedDeps } from "./onMerged";
import { upsertLocal, upsertRemote } from "./store";

const self = { id: machineId(), name: "mac" };
const repo = "github.com/acme/widgets";
const NOW = 10_000_000;
const FILES = ["lib/a.ts", "lib/b.ts", "lib/c.ts"];
let sessionId = "";

const deps = (o: Partial<MergedDeps> = {}) => {
  const d = {
    tell: vi.fn(async () => {}),
    idle: vi.fn(async () => true),
    clean: vi.fn(async () => true),
    refresh: vi.fn(async () => ({})),
    ...o,
  };
  return d;
};

// Overlap held and told, with the other side the winner (earlier start).
async function told(prUrl: string | null = null) {
  const { app } = seedWorkspace();
  sessionId = seedSession({ projectId: app.id, name: "Cache layer" });
  db.prepare(
    `UPDATE sessions SET worktree_path = '/tmp/wt', base_branch = 'main' WHERE id = ?`
  ).run(sessionId);
  if (prUrl) setPr(db, sessionId, { pr_url: prUrl });
  const wire = (released: "merged" | null) =>
    upsertRemote(
      self.id,
      "peer-1",
      {
        id: "r1",
        origin: "peer-1",
        origin_name: "box",
        hops: 0,
        source: "session",
        session_name: "Other",
        repo,
        branch: "feature/other",
        base: "main",
        goal: "Other work",
        files: FILES,
        files_more: 0,
        pr_url: null,
        ttl_s: 600,
        age_s: 7200,
        released,
      },
      NOW
    );
  upsertLocal(
    self,
    {
      sessionId,
      sessionName: "Cache layer",
      repo,
      branch: "feature/cache",
      base: "main",
      goal: "Cache layer",
      files: FILES,
      filesMore: 0,
      prUrl,
    },
    NOW
  );
  wire(null);
  const tell = async () => {};
  await notifyOverlaps(tell, NOW);
  await notifyOverlaps(tell, NOW + 60_000);
  return () => wire("merged");
}

beforeEach(() => {
  db.prepare(`DELETE FROM work_claims`).run();
  db.prepare(`DELETE FROM claim_notices`).run();
});

describe("handleMerged", () => {
  it("does nothing until the winner is tombstoned merged", async () => {
    await told();
    const d = deps();
    expect(await handleMerged(d, NOW + 120_000)).toBe(0);
    expect(d.tell).not.toHaveBeenCalled();
  });

  it("messages the yielder once and refreshes when idle and clean", async () => {
    const merge = await told();
    // the winner's tombstone comes back with more life, so it replaces the row
    db.prepare(`UPDATE work_claims SET expires_at = 1 WHERE id = 'r1'`).run();
    merge();
    const d = deps();
    expect(await handleMerged(d, NOW + 120_000)).toBe(1);
    expect(d.tell).toHaveBeenCalledOnce();
    expect(d.refresh).toHaveBeenCalledOnce();
    expect(await handleMerged(d, NOW + 180_000)).toBe(0);
    expect(d.tell).toHaveBeenCalledOnce();
  });

  it("tells but does not refresh a busy or dirty session", async () => {
    for (const o of [
      { idle: async () => false },
      { clean: async () => false },
    ]) {
      db.prepare(`DELETE FROM work_claims`).run();
      db.prepare(`DELETE FROM claim_notices`).run();
      const merge = await told();
      db.prepare(`UPDATE work_claims SET expires_at = 1 WHERE id = 'r1'`).run();
      merge();
      const d = deps(o);
      await handleMerged(d, NOW + 120_000);
      expect(d.tell).toHaveBeenCalledOnce();
      expect(d.refresh).not.toHaveBeenCalled();
    }
  });

  it("leaves a yielder with a PR to the rebase pipeline", async () => {
    const merge = await told("https://example.test/pr/4");
    db.prepare(`UPDATE work_claims SET expires_at = 1 WHERE id = 'r1'`).run();
    merge();
    const d = deps();
    expect(await handleMerged(d, NOW + 120_000)).toBe(0);
    expect(d.tell).not.toHaveBeenCalled();
    expect(d.refresh).not.toHaveBeenCalled();
  });
});
