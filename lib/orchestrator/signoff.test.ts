import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskPR } from "@/lib/tasks/state";
import type { ClaudeRun } from "./claude-cli";

// A real repository with a local bare remote; gh is faked around it.
let pr: TaskPR | null = null;
const merges: string[][] = [];
let pane = "";

vi.mock("@/lib/tasks/gh", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tasks/gh")>();
  return {
    ...real,
    run: async (cmd: string, args: string[], cwd: string, t?: number) => {
      if (cmd === "gh") {
        merges.push(args);
        if (pr) pr = { ...pr, state: "MERGED" };
        return "";
      }
      if (cmd === "tmux") throw new Error("no tmux in tests");
      return real.run(cmd, args, cwd, t);
    },
    findPR: async () => pr,
  };
});
vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: (t: string) => /Allow\?/.test(t),
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: () => pane !== "",
    getStatus: async () => "idle",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    capturePane: async () => pane,
  },
}));

const { db } = await import("@/lib/db");
const { createProject } = await import("@/lib/projects");
const { createWorkspace, setProjectWorkspace } =
  await import("@/lib/workspaces");
const { ensureOrchestrator } = await import("./home");
const { runTool } = await import("./serve");
const { review } = await import("./review");
const { getCheck } = await import("./checks");
const { failureOf } = await import("./gates");
const { listNotes } = await import("./notes");
const { listItems } = await import("@/lib/chat/store");
const { claudeArgs } = await import("./claude-cli");
const { seedSession } = await import("./testing");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-signoff-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
beforeEach(() => {
  merges.length = 0;
  pane = "";
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

function commit(repo: string, file: string, text: string): string {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", `change ${file}`);
  git(repo, "push", "-q", "origin", "HEAD");
  return git(repo, "rev-parse", "HEAD");
}

// A workspace whose project is a real clone, with a task on its branch
// and its PR open at the branch's head.
function setup(opts: { card?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-repo-"));
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, repo);
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  commit(repo, "README.md", "hello\n");
  git(repo, "checkout", "-qb", "feature/t");
  const sha = commit(repo, "src/a.ts", "export const a = 1;\n");

  const workspace = createWorkspace(`ws-${path.basename(root)}`);
  const project = createProject({
    name: `app-${path.basename(root)}`,
    workingDirectory: repo,
  });
  setProjectWorkspace(project.id, workspace.id);
  ensureOrchestrator(workspace.id);
  const task = seedSession({
    projectId: project.id,
    name: "add-a",
    task: true,
    branch: "feature/t",
  });
  db.prepare(
    `UPDATE sessions SET base_branch = 'main', task_prompt = 'Add a', lh_card_id = ?, pr_number = 7 WHERE id = ?`
  ).run(opts.card ? "card-1" : null, task);
  pr = {
    number: 7,
    url: "https://github.com/o/r/pull/7",
    state: "OPEN",
    checks: "pass",
    head: sha,
    failing: null,
  };
  const w = workspace.id;
  return {
    w,
    repo,
    task,
    sha,
    signOff: () => runTool(w, "sign_off", { task: "add-a" }),
    push: (file: string, text: string) => {
      const next = commit(repo, file, text);
      pr = { ...pr!, head: next };
      return next;
    },
  };
}

// A reviewer that answers without a model, and remembers how it was run.
function reviewer(verdict: "pass" | "block", within = true) {
  const runs: ClaudeRun[] = [];
  const claude = async (run: ClaudeRun) => {
    runs.push(run);
    if (!run.tools.length)
      return {
        within,
        reason: within ? "matches the card" : "adds billing, not on the card",
      };
    return verdict === "pass"
      ? { verdict, summary: "Looks right.", findings: [] }
      : {
          verdict,
          summary: "One bug.",
          findings: [
            {
              severity: "blocking",
              file: "src/a.ts",
              line: 1,
              summary: "off by one",
            },
          ],
        };
  };
  return { claude, runs };
}

const reviewNow = (
  w: string,
  verdict: "pass" | "block" = "pass",
  within = true
) => {
  const r = reviewer(verdict, within);
  return review(w, "add-a", { wait: true, claude: r.claude }).then((text) => ({
    text,
    runs: r.runs,
  }));
};

describe("review", () => {
  it("runs read-only in a checkout of the exact head commit and stores it per sha", async () => {
    const t = setup();
    const { text, runs } = await reviewNow(t.w);
    expect(text).toMatch(new RegExp(`Review of ${t.sha.slice(0, 7)}: pass`));
    expect(runs[0].tools).toEqual(["Read", "Grep", "Glob", "Bash"]);
    expect(runs[0].allow).not.toContain("Bash");
    expect(runs[0].prompt).toContain("A src/a.ts");
    const args = claudeArgs(runs[0]);
    expect(args).toEqual(
      expect.arrayContaining([
        "--permission-mode",
        "dontAsk",
        "--disallowedTools",
        "Edit",
        "Write",
      ])
    );
    // The checkout was at the head commit, and is gone afterwards.
    expect(runs[0].cwd).not.toBe(t.repo);
    expect(fs.existsSync(runs[0].cwd)).toBe(false);
    expect(getCheck(t.task, t.sha, "review")?.status).toBe("pass");

    // A new commit has no review until one runs on it.
    const next = t.push("src/b.ts", "export const b = 2;\n");
    expect(getCheck(t.task, next, "review")).toBeNull();
    await expect(t.signOff()).rejects.toThrow(
      new RegExp(`review: not yet, no review of ${next.slice(0, 7)} yet`)
    );
    expect(failureOf(t.task, "review")).toBeNull();
    expect(merges).toEqual([]);
  });
});

describe("sign_off", () => {
  it("fails a gate, then passes and merges at the reviewed commit", async () => {
    const t = setup();
    await reviewNow(t.w);
    pr = { ...pr!, checks: "fail", failing: "unit" };
    await expect(t.signOff()).rejects.toThrow(
      /- ci failed \(first\): CI failed on .* \(unit\)/
    );
    expect(failureOf(t.task, "ci")?.count).toBe(1);

    pr = { ...pr!, checks: "pass", failing: null };
    await expect(t.signOff()).resolves.toMatch(
      /Merged add-a: PR #7 squash-merged/
    );
    expect(merges).toEqual([
      ["pr", "merge", "7", "--squash", "--match-head-commit", t.sha],
    ]);
    const row = db
      .prepare(`SELECT task_status FROM sessions WHERE id = ?`)
      .get(t.task);
    expect(row).toEqual({ task_status: "merged" });
    expect(listNotes(t.w).at(-1)?.text).toMatch(/Merged add-a \(PR #7/);
  });

  it("escalates the second failure of the same gate, and then holds the task for Saad", async () => {
    const t = setup();
    await reviewNow(t.w);
    pr = { ...pr!, checks: "fail", failing: "unit" };
    await expect(t.signOff()).rejects.toThrow(/ci failed \(first\)/);
    await expect(t.signOff()).rejects.toThrow(
      /ci failed \(again\)[\s\S]*Escalated to Saad: the ci gate failed twice/
    );
    const notes = listNotes(t.w).filter((n) => n.kind === "escalation");
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toMatch(
      /^Saad must decide on add-a \(https:\/\/github.com\/o\/r\/pull\/7\)/
    );
    const orch = ensureOrchestrator(t.w);
    expect(listItems(orch.id).at(-1)).toMatchObject({
      kind: "note",
      tone: "escalation",
    });

    pr = { ...pr!, checks: "pass", failing: null };
    await expect(t.signOff()).rejects.toThrow(
      /is with Saad \(ci: .*\)\. Only he can merge it now/
    );
    expect(merges).toEqual([]);
  });

  it("fails the review gate on blocking findings", async () => {
    const t = setup();
    const { text } = await reviewNow(t.w, "block");
    expect(text).toMatch(
      /blocking findings[\s\S]*\[blocking\] src\/a.ts:1: off by one/
    );
    await expect(t.signOff()).rejects.toThrow(
      /review failed \(first\): .*off by one/
    );
  });

  it("fails the blocked gate on a BLOCKED: line or a waiting prompt", async () => {
    const t = setup();
    await reviewNow(t.w);
    pane = "working\n⏺ BLOCKED: need the staging key\n❯ ";
    await expect(t.signOff()).rejects.toThrow(
      /blocked failed \(first\): the task is BLOCKED: need the staging key/
    );
    pane = "Run tests?\nAllow? (y/n)";
    await expect(t.signOff()).rejects.toThrow(
      /blocked failed \(again\): the task is waiting on an answer/
    );
  });

  it("checks a card's task against its card, stored with the review", async () => {
    const t = setup({ card: true });
    const { runs } = await reviewNow(t.w, "pass", false);
    expect(runs.map((r) => r.tools.length)).toEqual([4, 0]);
    expect(getCheck(t.task, t.sha, "scope")?.status).toBe("block");
    await expect(t.signOff()).rejects.toThrow(
      /scope failed \(first\): the scope check .* out of scope: adds billing/
    );
  });

  it("fails scope on a secret in the diff", async () => {
    const t = setup();
    t.push(
      "src/config.ts",
      'export const KEY = "ghp_abcdefghijklmnopqrstuvwxyz123456";\n'
    );
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(
      /scope failed \(first\): it adds what looks like a secret/
    );
  });

  it("never merges CI, deploy or secrets-handling changes, whatever the gates say", async () => {
    const t = setup();
    t.push(".github/workflows/ci.yml", "on: push\n");
    await reviewNow(t.w);
    await expect(t.signOff()).rejects.toThrow(
      /Escalated to Saad: PR #7 at .* touches \.github\/workflows\/ci\.yml \(CI config\)/
    );
    expect(merges).toEqual([]);
    expect(listNotes(t.w).at(-1)).toMatchObject({ kind: "escalation" });
    await expect(t.signOff()).rejects.toThrow(/is with Saad \(sensitive/);
  });
});
