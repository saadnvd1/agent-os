import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TmuxSessionInfo } from "@/lib/status-detector";
import type { ClaudeRun } from "./claude-cli";

// A real clone whose origin reads as github.com/o/r (git rewrites it to a
// local bare remote); gh is faked around it.
interface FakePR {
  number: number;
  url: string;
  state: string;
  headRefOid: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  labels: { name: string }[];
  isCrossRepository: boolean;
  statusCheckRollup: unknown[];
  body: string;
  title: string;
}
let pr: FakePR | null = null;
const merges: string[][] = [];
let tmux: TmuxSessionInfo[] = [];
let pane = "";

vi.mock("@/lib/tasks/gh", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tasks/gh")>();
  return {
    ...real,
    run: async (cmd: string, args: string[], cwd: string, t?: number) => {
      if (cmd !== "gh") return real.run(cmd, args, cwd, t);
      const repo = args[args.indexOf("--repo") + 1];
      if (args[0] === "pr" && args[1] === "merge") {
        merges.push(args);
        return "";
      }
      if (args[0] === "pr" && args[1] === "view") {
        if (repo !== "o/r" || !pr || args[2] !== String(pr.number))
          throw new Error("no pull requests found");
        return JSON.stringify(pr);
      }
      if (args[0] === "pr" && args[1] === "list") {
        const head = args[args.indexOf("--head") + 1];
        return JSON.stringify(
          pr && repo === "o/r" && head === pr.headRefName
            ? [{ number: pr.number, url: pr.url }]
            : []
        );
      }
      throw new Error(`unexpected gh ${args.join(" ")}`);
    },
  };
});
vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: () => false,
  statusDetector: {
    refreshCache: async () => {},
    cachedSessions: () => tmux,
    sessionExists: () => false,
    getStatus: async () => "idle",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    hostErrors: () => ({}),
    capturePane: async () => pane,
  },
}));

const { db } = await import("@/lib/db");
const { createProject } = await import("@/lib/projects");
const { createWorkspace, setProjectWorkspace } =
  await import("@/lib/workspaces");
const { runTool } = await import("./serve");
const { reviewTarget } = await import("./external-gates");
const { putCheck } = await import("./checks");
const { openAsks } = await import("./asks");
const { setMergeApprovals } = await import("./merge-approvals");
const { seedSession } = await import("./testing");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-external-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
beforeEach(() => {
  merges.length = 0;
  tmux = [];
  pane = "";
  setMergeApprovals(false);
  // Every test's PR is o/r#50: what one left on it isn't the next's.
  db.exec(
    `DELETE FROM orchestrator_gate_failures; DELETE FROM orchestrator_asks; DELETE FROM orchestrator_checks;`
  );
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" },
  }).trim();

function commit(repo: string, file: string, text: string): string {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", `change ${file}`);
  git(repo, "push", "-q", "origin", "HEAD");
  return git(repo, "rev-parse", "HEAD");
}

// A clone of `slug` with an origin that reads as github.com but fetches
// from a local bare repository.
function clone(root: string, slug: string, name: string) {
  const remote = path.join(root, `${name}.git`);
  const repo = path.join(root, name);
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, repo);
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  git(repo, "remote", "set-url", "origin", `https://github.com/${slug}.git`);
  git(
    repo,
    "config",
    `url.${remote}.insteadOf`,
    `https://github.com/${slug}.git`
  );
  commit(repo, "README.md", "hello\n");
  return repo;
}

// A workspace whose project is a clone of o/r, with a branch pushed that
// dispatch opened PR #50 from (no AgentOS task behind it).
function setup() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-ext-repo-"))
  );
  const repo = clone(root, "o/r", "repo");
  git(repo, "checkout", "-qb", "ws-wor-52");
  const sha = commit(repo, "src/a.ts", "export const a = 1;\n");
  git(repo, "checkout", "-q", "main");
  const workspace = createWorkspace(`ws-${path.basename(root)}`);
  const project = createProject({
    name: `app-${path.basename(root)}`,
    workingDirectory: repo,
  });
  setProjectWorkspace(project.id, workspace.id);
  pr = {
    number: 50,
    url: "https://github.com/o/r/pull/50",
    state: "OPEN",
    headRefOid: sha,
    headRefName: "ws-wor-52",
    baseRefName: "main",
    isDraft: false,
    labels: [],
    isCrossRepository: false,
    statusCheckRollup: [
      {
        __typename: "CheckRun",
        name: "ci",
        status: "COMPLETED",
        conclusion: "SUCCESS",
      },
    ],
    body: "## WOR-52\n\nFixed the schema dump.",
    title: "Schema dumps the same everywhere",
  };
  const w = workspace.id;
  // CI has looked settled on the head for a while.
  putCheck({
    workspaceId: w,
    sessionId: "pr:o/r#50",
    sha,
    kind: "ci",
    status: "pass",
    detail: JSON.stringify({ count: 1, at: 0 }),
  });
  return { w, root, repo, sha, projectId: project.id };
}

const passing = async (run: ClaudeRun) => {
  passing.runs.push(run);
  return { verdict: "pass", summary: "Looks right.", findings: [] };
};
passing.runs = [] as ClaudeRun[];

describe("sign_off on a PR no task owns", () => {
  it("runs the gates by #N, names the missing Code review section, and merges the judged head after a review", async () => {
    const t = setup();
    const first = runTool(t.w, "sign_off", { task: "#50" });
    await expect(first).rejects.toThrow(
      /o\/r#50 \(PR #50 at [0-9a-f]{7}\) can't merge:/
    );
    await expect(first).rejects.toThrow(/review: not yet, no review of/);
    await expect(first).rejects.toThrow(
      /code-review: not yet, o\/r#50's body has no "Code review" section; for a PR AgentOS didn't open, the orchestrator's own review of [0-9a-f]{7} stands in for it: call review/
    );
    expect(merges).toEqual([]);

    passing.runs.length = 0;
    const text = await reviewTarget(t.w, "o/r#50", {
      wait: true,
      claude: passing,
    });
    expect(text).toMatch(/Review of [0-9a-f]{7}: pass/);
    // The reviewer reads the PR's own words as the goal, fenced as data.
    expect(passing.runs[0].prompt).toContain(
      "Schema dumps the same everywhere"
    );
    expect(passing.runs[0].prompt).toContain("A src/a.ts");

    const done = await runTool(t.w, "sign_off", {
      task: "https://github.com/o/r/pull/50",
    });
    expect(done).toBe(`Merged o/r#50: squash-merged at ${t.sha.slice(0, 7)}.`);
    expect(merges).toEqual([
      [
        "pr",
        "merge",
        "50",
        "--repo",
        "o/r",
        "--squash",
        "--match-head-commit",
        t.sha,
      ],
    ]);
  });

  it("refuses a repository that isn't one of the workspace's, naming why", async () => {
    const t = setup();
    await expect(
      runTool(t.w, "sign_off", { task: "acme/other#50" })
    ).rejects.toThrow(
      /acme\/other isn't the repository of any project in .* \(its repositories: o\/r\)\. The orchestrator merges only inside its workspace\./
    );
    await expect(
      runTool(t.w, "review", { target: "https://github.com/acme/other/pull/3" })
    ).rejects.toThrow(/acme\/other isn't the repository of any project/);
    expect(merges).toEqual([]);
  });

  it("holds a section that doesn't cover the head, and AI attribution, to a task's rules", async () => {
    const t = setup();
    await reviewTarget(t.w, "#50", { wait: true, claude: passing });
    pr = { ...pr!, body: "## Code review\nReviewed: 0123456789abcdef0123" };
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /code-review failed \(first\): the PR's code review covers 0123456, not its head [0-9a-f]{7}: o\/r#50's "Code review" section has to name/
    );
    // Each its own first failure: a second of one gate goes to Saad.
    db.exec(`DELETE FROM orchestrator_gate_failures`);
    pr = { ...pr!, body: "Fixes it.\n\nGenerated with [Claude Code](x)" };
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /code-review failed .*AI attribution/
    );
    db.exec(`DELETE FROM orchestrator_gate_failures`);
    pr = { ...pr!, body: `## Code review\nReviewed: ${t.sha}` };
    await expect(runTool(t.w, "sign_off", { task: "#50" })).resolves.toMatch(
      /^Merged o\/r#50/
    );
  });

  it("waits on a draft and fails on a blocked label: there's no session to read", async () => {
    const t = setup();
    await reviewTarget(t.w, "#50", { wait: true, claude: passing });
    pr = { ...pr!, isDraft: true };
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /blocked: not yet, o\/r#50 is a draft/
    );
    pr = { ...pr!, isDraft: false, labels: [{ name: "Blocked" }] };
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /blocked failed \(first\): o\/r#50 carries the label/
    );
    expect(merges).toEqual([]);
  });

  it("escalates a repository with no CI to Saad as an ask about the PR", async () => {
    const t = setup();
    await reviewTarget(t.w, "#50", { wait: true, claude: passing });
    pr = { ...pr!, statusCheckRollup: [] };
    putCheck({
      workspaceId: t.w,
      sessionId: "pr:o/r#50",
      sha: t.sha,
      kind: "ci",
      status: "pass",
      detail: JSON.stringify({ count: 0, at: 0 }),
    });
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /Escalated to Saad: no CI ran/
    );
    expect(openAsks(t.w)).toEqual([
      expect.objectContaining({
        subject: "pr:o/r#50",
        title: "Merge o/r#50?",
        link: "https://github.com/o/r/pull/50",
        sha: t.sha,
      }),
    ]);
  });

  it("gates a PR from a running task's branch as that task", async () => {
    const t = setup();
    seedSession({
      projectId: t.projectId,
      name: "schema-fix",
      task: true,
      branch: "ws-wor-52",
    });
    // The task's PR isn't recorded on its row yet: still its own.
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /^schema-fix /
    );
  });
});

const tmuxAt = (name: string, p: string): TmuxSessionInfo => ({
  name,
  hostId: "local",
  activity: Math.floor(Date.now() / 1000),
  output: 0,
  path: p,
  attached: false,
  windows: 1,
  command: "claude",
  title: "",
  pid: 0,
});

describe("external sessions", () => {
  it("lists a tmux session in a worktree of a workspace repo with its PR, and not one elsewhere", async () => {
    const t = setup();
    const worktree = path.join(t.root, "dispatch-wt");
    git(t.repo, "worktree", "add", "-q", worktree, "ws-wor-52");
    const elsewhere = clone(t.root, "acme/other", "other");
    tmux = [
      tmuxAt("ws-wor-52", worktree),
      tmuxAt("someone-else", elsewhere),
      tmuxAt("in-project", t.repo),
    ];
    const out = await runTool(t.w, "sessions");
    expect(out).toMatch(
      /2 external sessions \(not started by AgentOS; read only/
    );
    expect(out).toMatch(
      /- ws-wor-52 \(app-[^,]+, branch <untrusted[^>]*>ws-wor-52<\/untrusted>, PR o\/r#50\)/
    );
    expect(out).toMatch(
      /- in-project \(app-[^,]+, branch <untrusted[^>]*>main<\/untrusted>, no open PR\)/
    );
    expect(out).not.toContain("someone-else");
  });

  it("reads an external session's screen and refuses to send to it", async () => {
    const t = setup();
    tmux = [tmuxAt("ws-wor-52", t.repo)];
    pane = "working on WOR-52\n❯ ";
    const text = await runTool(t.w, "read", { session: "ws-wor-52" });
    expect(text).toMatch(
      /^ws-wor-52 \(external terminal on this machine, not started by AgentOS\), last 60 lines:/
    );
    expect(text).toContain("working on WOR-52");
    await expect(
      runTool(t.w, "send", { session: "ws-wor-52", message: "hi" })
    ).rejects.toThrow(
      /ws-wor-52 is an external session \(not started by AgentOS\) on this machine: read it with read; it can't be sent to/
    );
    // Not an orchestrator's to read when it's in no workspace project.
    tmux = [tmuxAt("stray", os.tmpdir())];
    await expect(runTool(t.w, "read", { session: "stray" })).rejects.toThrow(
      /No session "stray"/
    );
  });
});

