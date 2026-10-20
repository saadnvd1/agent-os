import { beforeEach, describe, expect, it } from "vitest";
import { seedSession, seedWorkspace } from "@/lib/orchestrator/testing";

const { db } = await import("@/lib/db");
const { machineId } = await import("@/lib/claims/machine");
const { upsertLocal, upsertRemote } = await import("@/lib/claims/store");
const { refreshOverlapCache, resetOverlapCache } =
  await import("@/lib/claims/overlapCache");
const { GET } = await import("./route");

const REPO = "git.example.test/team/widgets";

beforeEach(() => {
  db.prepare(`DELETE FROM work_claims`).run();
  resetOverlapCache();
});

function localClaim(sessionId: string, files: string[]) {
  upsertLocal(
    { id: machineId(), name: "here" },
    {
      sessionId,
      sessionName: "Tidy auth",
      repo: REPO,
      branch: "feature/tidy",
      base: "main",
      goal: "Tidy auth",
      files,
      filesMore: 0,
      prUrl: null,
    }
  );
}

const remote = (id: string, files: string[], branch = "feature/login") =>
  upsertRemote(machineId(), "peer-1", {
    id,
    origin: "box-machine",
    origin_name: "box",
    hops: 0,
    source: "session",
    session_name: "Rework login sessions",
    repo: REPO,
    branch,
    base: "main",
    goal: "Rework login sessions",
    files,
    files_more: 0,
    pr_url: null,
    ttl_s: 600,
    age_s: 60,
    released: null,
  });

const FILES = ["a/one.ts", "a/two.ts", "a/three.ts"];

const rows = async () => {
  const body = await (await GET()).json();
  return body as {
    sessions: { id: string; overlap?: Record<string, unknown> | null }[];
    claims: { id: string; fileCount: number; files?: string[] }[];
    claimOverlaps: { a: string; b: string; strength: string }[];
  };
};

describe("GET /api/sessions with claims", () => {
  it("puts a strong overlap on the session that has it, and no other", async () => {
    const t = seedWorkspace();
    const mine = seedSession({ projectId: t.app.id, name: "Tidy auth" });
    const other = seedSession({ projectId: t.app.id, name: "Unrelated" });
    localClaim(mine, FILES);
    remote("claim-box-1", FILES);
    refreshOverlapCache();
    const body = await rows();
    expect(body.sessions.find((s) => s.id === mine)?.overlap).toEqual({
      strength: "strong",
      machine: "box",
      goal: "Rework login sessions",
      shared: 3,
      claimId: "claim-box-1",
      mineId: `s-${mine}`,
    });
    expect(body.sessions.find((s) => s.id === other)?.overlap).toBeUndefined();
  });

  it("marks a small file overlap weak", async () => {
    const t = seedWorkspace();
    const mine = seedSession({ projectId: t.app.id, name: "Tidy auth" });
    localClaim(mine, ["a/1.ts", "a/2.ts", "a/3.ts", "a/4.ts", "a/5.ts"]);
    remote(
      "claim-box-2",
      ["a/1.ts", "a/2.ts", "b/1.ts", "b/2.ts", "b/3.ts"],
      "feature/other"
    );
    refreshOverlapCache();
    const row = (await rows()).sessions.find((s) => s.id === mine);
    expect(row?.overlap?.strength).toBe("weak");
  });

  it("lists claims without their paths, and the overlapping pairs", async () => {
    const t = seedWorkspace();
    const mine = seedSession({ projectId: t.app.id, name: "Tidy auth" });
    localClaim(mine, FILES);
    remote("claim-box-1", FILES);
    refreshOverlapCache();
    const body = await rows();
    expect(body.claims.map((c) => c.id).sort()).toEqual(
      [`s-${mine}`, "claim-box-1"].sort()
    );
    expect(body.claims.every((c) => c.fileCount === 3 && !c.files)).toBe(true);
    expect(body.claimOverlaps).toHaveLength(1);
    expect(body.claimOverlaps[0].strength).toBe("strong");
  });

  it("serves no claims before the loop has run", async () => {
    const t = seedWorkspace();
    seedSession({ projectId: t.app.id, name: "Tidy auth" });
    const body = await rows();
    expect(body.claims).toEqual([]);
    expect(body.sessions.every((s) => !s.overlap)).toBe(true);
  });
});
