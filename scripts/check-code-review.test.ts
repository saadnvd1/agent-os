// Runs the checker the way CI does (its own process, env in, exit code
// out), so a path that exits 0 without checking shows up here.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const SCRIPT = path.join(ROOT, "scripts", "check-code-review.ts");
const HEAD = "4f2a9c1e0b7d3a5c6e8f9a0b1c2d3e4f5a6b7c8d";
const OTHER = "0123456789abcdef0123456789abcdef01234567";
const body = (sha: string) =>
  `## What changed\n\nStuff\n\n## Code review\nReviewed: ${sha}\nAgents: review-security\nFixed: none\nDeferred: none\n`;

function check(env: { PR_BODY?: string; HEAD_SHA?: string }) {
  const { PR_BODY: _b, HEAD_SHA: _h, ...rest } = process.env;
  const run = spawnSync(TSX, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...rest,
      ...Object.fromEntries(
        Object.entries(env).filter(([, v]) => v !== undefined)
      ),
    },
    encoding: "utf8",
  });
  return { code: run.status, out: run.stdout, err: run.stderr };
}

describe("scripts/check-code-review.ts", () => {
  it("passes a body whose section names the head commit", () => {
    const run = check({ PR_BODY: body(HEAD), HEAD_SHA: HEAD });
    expect(run).toMatchObject({ code: 0 });
    expect(run.out).toContain(`covers ${HEAD}`);
  });

  it("passes a 12-character prefix of the head", () => {
    expect(
      check({ PR_BODY: body(HEAD.slice(0, 12)), HEAD_SHA: HEAD }).code
    ).toBe(0);
  });

  it("fails a review of another commit", () => {
    const run = check({ PR_BODY: body(OTHER), HEAD_SHA: HEAD });
    expect(run.code).toBe(1);
    expect(run.err).toContain("not its head");
  });

  it("fails a body with no section", () => {
    const run = check({
      PR_BODY: "## What changed\n\nStuff\n",
      HEAD_SHA: HEAD,
    });
    expect(run.code).toBe(1);
    expect(run.err).toContain("no Code review section");
  });

  it("fails closed on an unset, empty or blank body", () => {
    for (const env of [
      { HEAD_SHA: HEAD },
      { PR_BODY: "", HEAD_SHA: HEAD },
      { PR_BODY: " \n\t\n", HEAD_SHA: HEAD },
    ]) {
      const run = check(env);
      expect(run.code).toBe(1);
      expect(run.err).toContain("body is empty");
    }
  });

  it("fails closed on a missing or malformed head sha", () => {
    // "null" is what `jq -r .headRefOid` prints when the field is missing.
    for (const HEAD_SHA of [
      undefined,
      "",
      "null",
      HEAD.slice(0, 12),
      `${HEAD}x`,
    ]) {
      const run = check({ PR_BODY: body(HEAD), HEAD_SHA });
      expect(run.code).toBe(1);
      expect(run.err).toContain("head commit is unknown");
    }
  });
});
