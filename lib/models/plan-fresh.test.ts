import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { checkPlanFile } from "./plan-fresh";

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

// A repo whose main has a committed plan, and a worktree cut from it.
function stale() {
  const repo = tempDir("pf-");
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.email", "t@example.test");
  sh(repo, "config", "user.name", "t");
  fs.mkdirSync(path.join(repo, ".agentos"));
  fs.writeFileSync(path.join(repo, ".agentos", "plan.md"), "# old plan\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "i");
  const wt = path.join(tempDir("pf-wt-"), "wt");
  sh(repo, "worktree", "add", "-q", "-b", "f", wt);
  return { repo, wt, plan: path.join(wt, ".agentos", "plan.md") };
}

describe("checkPlanFile", () => {
  it("refuses a plan that is tracked and unchanged", async () => {
    const { wt } = stale();
    const v = await checkPlanFile(wt, "main");
    expect(v).toMatchObject({ ok: false });
    expect(v && !v.ok && v.why).toMatch(/tracked/);
  });

  it("refuses a plan older than the task's plan folder", async () => {
    const { wt, plan } = stale();
    sh(wt, "rm", "-q", "--cached", ".agentos/plan.md");
    fs.writeFileSync(path.join(wt, ".agentos", ".gitignore"), "*\n");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(plan, old, old);
    const v = await checkPlanFile(wt, "main");
    expect(v && !v.ok && v.why).toMatch(/since the task started/);
  });

  it("refuses an untracked copy identical to the base's", async () => {
    const { wt } = stale();
    sh(wt, "rm", "-q", "--cached", ".agentos/plan.md");
    const v = await checkPlanFile(wt, "main");
    expect(v && !v.ok && v.why).toMatch(/identical to/);
  });

  it("accepts a plan written during the task, and null when missing", async () => {
    const { wt, plan } = stale();
    sh(wt, "rm", "-q", "--cached", ".agentos/plan.md");
    fs.writeFileSync(plan, "# new plan\n");
    expect(await checkPlanFile(wt, "main")).toEqual({
      ok: true,
      text: "# new plan\n",
    });
    fs.rmSync(plan);
    expect(await checkPlanFile(wt, "main")).toBeNull();
  });
});
