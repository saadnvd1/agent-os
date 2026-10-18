import { execFileSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  checkDeploy,
  DEFAULT_DEPS,
  HEALTH_GRACE_MS,
  type DeployDeps,
} from "./deploy";
import { tempDir } from "@/lib/test-temp";

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
  committedAt?: number;
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
    committedAt: async () => opts.committedAt ?? 0,
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

  it("waits rather than fails when git can't tell (a fetch that failed)", async () => {
    const d = deps({ files: { [config.deployed]: { sha: OTHER } } });
    d.contains = async () => {
      throw new Error("fetch failed");
    };
    expect(
      await checkDeploy(input({ mergedAt: NOW - 60 * 60 * 1000 }), d)
    ).toEqual({ state: "pending" });
  });

  it("catches a server that answers but hasn't restarted since the merge commit", async () => {
    const committedAt = NOW - 10 * 60 * 1000;
    const files = (at: number) => ({ [config.deployed]: { sha: MERGE, at } });
    const server = (at: number, startedAt: number) => {
      const d = deps({ files: files(at), committedAt });
      d.health = async () => ({ ok: true, startedAt });
      return d;
    };
    const before = committedAt - 1000;
    expect(await checkDeploy(input(), server(NOW - 1000, before))).toEqual({
      state: "pending",
    });
    expect(
      await checkDeploy(input(), server(NOW - HEALTH_GRACE_MS, before))
    ).toMatchObject({
      state: "failed",
      detail: expect.stringContaining("hasn't restarted since the merge"),
    });
    // AgentOS noticed the merge after the restart: still healthy, since the
    // restart came after the commit.
    expect(
      (
        await checkDeploy(
          input({ mergedAt: NOW }),
          server(NOW - HEALTH_GRACE_MS, committedAt + 1000)
        )
      ).state
    ).toBe("ok");
  });
});

describe("whether a deployed commit has the merge, in a real repository", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

  function repo() {
    const dir = tempDir("away-deploy-");
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "test@example.test");
    git(dir, "config", "user.name", "test");
    git(dir, "commit", "-q", "--allow-empty", "-m", "one");
    const first = git(dir, "rev-parse", "HEAD");
    git(dir, "commit", "-q", "--allow-empty", "-m", "two");
    const second = git(dir, "rev-parse", "HEAD");
    // An origin that can't be fetched from.
    git(dir, "remote", "add", "origin", path.join(dir, "missing"));
    return { dir, first, second };
  }

  it("tells from history without fetching, and throws when a fetch would be needed and fails", async () => {
    const { dir, first, second } = repo();
    expect(await DEFAULT_DEPS.contains(dir, second, first)).toBe(true);
    await expect(
      DEFAULT_DEPS.contains(dir, second, "f".repeat(40))
    ).rejects.toThrow();
  });
});
