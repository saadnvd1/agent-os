import { describe, expect, it } from "vitest";
import { checkDeploy, HEALTH_GRACE_MS, type DeployDeps } from "./deploy";

const NOW = Date.parse("2026-10-10T20:00:00Z");
// Commits are built here rather than written out.
const sha = (c: string) => c.repeat(40);
const MERGE = sha("a");
const LATER = sha("b");
const OTHER = sha("c");

// `history`: each commit and what it contains.
function deps(opts: {
  files?: Record<string, { sha: string; at?: number }>;
  history?: Record<string, string[]>;
  healthy?: boolean;
}): DeployDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    readSha: (file) => {
      const f = opts.files?.[file];
      return f ? { sha: f.sha, at: f.at ?? NOW - HEALTH_GRACE_MS * 2 } : null;
    },
    contains: async (_repo, tip, s) =>
      tip === s || (opts.history?.[tip] ?? []).includes(s),
    health: async (url) => {
      asked.push(url);
      return opts.healthy === false
        ? { ok: false, why: "HTTP 502" }
        : { ok: true };
    },
  };
}

const config = {
  deployed: "~/state/deployed",
  failed: "~/state/alerted",
  health: "https://app.example.test/health",
};
const input = (over: Partial<Parameters<typeof checkDeploy>[0]> = {}) => ({
  repo: "/tmp/repo",
  config,
  mergeSha: MERGE,
  mergedAt: NOW - 5 * 60 * 1000,
  now: NOW,
  ...over,
});

describe("checking a merge's deploy", () => {
  it("is ok once a deployed commit contains the merge and the server answers healthy", async () => {
    const d = deps({
      files: { [config.deployed]: { sha: LATER } },
      history: { [LATER]: [MERGE] },
    });
    expect(await checkDeploy(input(), d)).toEqual({
      state: "ok",
      detail: "aaaaaaa deployed, server healthy",
    });
    expect(d.asked).toEqual([config.health]);
  });

  it("fails a landed deploy whose server doesn't come back, after a grace period", async () => {
    const files = (at: number) => ({ [config.deployed]: { sha: MERGE, at } });
    expect(
      await checkDeploy(
        input(),
        deps({ files: files(NOW - 1000), healthy: false })
      )
    ).toEqual({ state: "pending" });
    const failed = await checkDeploy(
      input(),
      deps({ files: files(NOW - HEALTH_GRACE_MS), healthy: false })
    );
    expect(failed.state).toBe("failed");
    expect(failed).toMatchObject({
      detail: expect.stringContaining("HTTP 502"),
    });
  });

  it("fails when the deploy that has the merge failed", async () => {
    const d = deps({
      files: {
        [config.deployed]: { sha: OTHER },
        [config.failed]: { sha: LATER },
      },
      history: { [LATER]: [MERGE] },
    });
    const v = await checkDeploy(input(), d);
    expect(v.state).toBe("failed");
    expect(v).toMatchObject({ detail: expect.stringContaining("bbbbbbb") });
  });

  it("waits for a merge still inside its window, and fails it past the window", async () => {
    const d = deps({ files: { [config.deployed]: { sha: OTHER } } });
    expect(await checkDeploy(input(), d)).toEqual({ state: "pending" });
    const late = await checkDeploy(
      input({ mergedAt: NOW - 31 * 60 * 1000 }),
      d
    );
    expect(late).toMatchObject({
      state: "failed",
      detail: "aaaaaaa not deployed 30 minutes after the merge",
    });
  });

  it("doesn't check a project without a deploy config, or a machine that doesn't deploy", async () => {
    expect(
      (await checkDeploy(input({ config: undefined }), deps({}))).state
    ).toBe("unchecked");
    expect((await checkDeploy(input(), deps({}))).state).toBe("unchecked");
  });

  it("waits while the merge commit isn't known yet", async () => {
    expect(
      await checkDeploy(
        input({ mergeSha: null }),
        deps({ files: { [config.deployed]: { sha: MERGE } } })
      )
    ).toEqual({ state: "pending" });
  });
});
