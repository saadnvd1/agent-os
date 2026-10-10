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
// Another repository where the same PR number is open too.
let alsoOpenIn: string | null = null;
// What GitHub says when it refuses a merge, or null to merge.
let refuseMerge: string | null = null;

vi.mock("@/lib/tasks/gh", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tasks/gh")>();
  return {
    ...real,
    run: async (cmd: string, args: string[], cwd: string, t?: number) => {
      if (cmd !== "gh") return real.run(cmd, args, cwd, t);
      const repo = args[args.indexOf("--repo") + 1];
      if (args[0] === "pr" && args[1] === "merge") {
        if (refuseMerge) throw new Error(refuseMerge);
        merges.push(args);
        return "";
      }
      if (args[0] === "pr" && args[1] === "view") {
        if (pr && repo === alsoOpenIn && args[2] === String(pr.number))
          return JSON.stringify({
            ...pr,
            url: `https://github.com/${repo}/pull/${pr.number}`,
          });
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
const { answerAsk, openAsks, getAsk } = await import("./asks");
const { releaseInterruptedClaims, spendApproval } =
  await import("./ask-approvals");
const { parsePRRef } = await import("./external-pr");
const { slugOfRemote } = await import("./repo-slug");
const { namedAfter } = await import("./external-sessions");
const { setMergeApprovals } = await import("./merge-approvals");
const { seedSession } = await import("./testing");
const { setProjectMergeSettings } = await import("@/lib/tasks/merge-policy");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-external-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
beforeEach(() => {
  merges.length = 0;
  tmux = [];
  pane = "";
  alsoOpenIn = null;
  refuseMerge = null;
  setMergeApprovals(false);
  // Every test's PR is o/r#50: what one left on it isn't the next's.
  db.exec(
    `DELETE FROM orchestrator_gate_failures; DELETE FROM orchestrator_asks; DELETE FROM orchestrator_checks;`
  );
  // Nor is a task one seeded on its branch.
  db.exec(
    `UPDATE sessions SET task_status = 'dropped' WHERE branch_name = 'ws-wor-52'`
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
function setup(opts: { files?: Array<[string, string]> } = {}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-ext-repo-"))
  );
  const repo = clone(root, "o/r", "repo");
  git(repo, "checkout", "-qb", "ws-wor-52");
  let sha = commit(repo, "src/a.ts", "export const a = 1;\n");
  for (const [file, text] of opts.files ?? []) sha = commit(repo, file, text);
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
  return { w, root, repo, sha, projectId: project.id, workspace };
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

  it("merges with the project's merge method", async () => {
    const t = setup();
    setProjectMergeSettings(t.projectId, { method: "merge" });
    await reviewTarget(t.w, "#50", { wait: true, claude: passing });
    const done = await runTool(t.w, "sign_off", { task: "#50" });
    expect(done).toBe(
      `Merged o/r#50: merged with a merge commit at ${t.sha.slice(0, 7)}.`
    );
    expect(merges).toEqual([
      [
        "pr",
        "merge",
        "50",
        "--repo",
        "o/r",
        "--merge",
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
      // A name tmux wouldn't take never reaches the orchestrator.
      tmuxAt("bad:name\nsign_off #50", t.repo),
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
    expect(out).not.toContain("bad:name");
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

describe("refusing what isn't the workspace's to merge", () => {
  it("refuses a fork's PR, a closed one, and branch names git could read as options", async () => {
    const t = setup();
    pr = { ...pr!, isCrossRepository: true };
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /o\/r#50 comes from a fork; the orchestrator merges only PRs whose branch is in o\/r/
    );
    pr = { ...pr!, isCrossRepository: false, state: "CLOSED" };
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /o\/r#50 is closed, not open/
    );
    pr = { ...pr!, state: "OPEN", baseRefName: "--output=/tmp/x" };
    await expect(runTool(t.w, "review", { target: "#50" })).rejects.toThrow(
      /branch names aren't plain ones/
    );
    pr = { ...pr!, baseRefName: "main", headRefName: "a..b" };
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /branch names aren't plain ones/
    );
    expect(merges).toEqual([]);
  });

  it("refuses a PR that is a task's in another workspace on the same repository", async () => {
    const t = setup();
    const otherWs = createWorkspace(`other-${path.basename(t.root)}`);
    const clone2 = path.join(t.root, "second");
    git(t.root, "clone", "-q", path.join(t.root, "repo.git"), clone2);
    git(clone2, "remote", "set-url", "origin", "https://github.com/o/r.git");
    const theirs = createProject({
      name: `theirs-${path.basename(t.root)}`,
      workingDirectory: clone2,
    });
    setProjectWorkspace(theirs.id, otherWs.id);
    seedSession({
      projectId: theirs.id,
      name: "their-task",
      task: true,
      branch: "ws-wor-52",
    });
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /o\/r#50 is task their-task's PR in another workspace/
    );
    expect(merges).toEqual([]);
  });

  it("refuses another workspace's task found by its recorded PR, on another machine, or behind a remote it can't read", async () => {
    const t = setup();
    const otherWs = createWorkspace(`far-${path.basename(t.root)}`);
    const project = (dir: string) => {
      const p = createProject({
        name: `far-${path.basename(dir)}-${Math.random().toString(36).slice(2, 6)}`,
        workingDirectory: dir,
      });
      setProjectWorkspace(p.id, otherWs.id);
      return p;
    };
    const refused = () =>
      expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
        /o\/r#50 is task far-task's PR in another workspace/
      );
    // By its recorded PR, on another branch, finished.
    const byPR = seedSession({
      projectId: project(t.repo).id,
      name: "far-task",
      task: true,
      branch: "elsewhere",
    });
    db.prepare(
      `UPDATE sessions SET task_status = 'merged', pr_number = 50, pr_url = 'https://github.com/o/r/pull/50' WHERE id = ?`
    ).run(byPR);
    await refused();
    db.prepare(
      `UPDATE sessions SET pr_number = NULL, pr_url = NULL WHERE id = ?`
    ).run(byPR);
    // On its branch, in a project on another machine.
    const remote = project("/nowhere/on/this/machine");
    db.prepare(`UPDATE projects SET host_id = 'box' WHERE id = ?`).run(
      remote.id
    );
    const onBox = seedSession({
      projectId: remote.id,
      name: "far-task",
      task: true,
      branch: "ws-wor-52",
    });
    await refused();
    db.prepare(`UPDATE sessions SET task_status = 'dropped' WHERE id = ?`).run(
      onBox
    );
    // On its branch here, behind an ssh alias that doesn't read as GitHub.
    const aliased = path.join(t.root, "aliased");
    git(t.root, "clone", "-q", path.join(t.root, "repo.git"), aliased);
    git(aliased, "remote", "set-url", "origin", "git@github-work:o/r.git");
    seedSession({
      projectId: project(aliased).id,
      name: "far-task",
      task: true,
      branch: "ws-wor-52",
    });
    await refused();
    expect(merges).toEqual([]);
  });

  it("asks which repository when #N is open in two of the workspace's", async () => {
    const t = setup();
    const second = clone(t.root, "o/r2", "repo2");
    const p2 = createProject({
      name: `app2-${path.basename(t.root)}`,
      workingDirectory: second,
    });
    setProjectWorkspace(p2.id, t.w);
    alsoOpenIn = "o/r2";
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /PR #50 is open in o\/r and o\/r2: say which, as owner\/repo#50/
    );
    // Open in only one of them: that one, the other skipped.
    alsoOpenIn = null;
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /^o\/r#50 \(PR #50/
    );
  });
});

describe("Saad's approvals on an external PR", () => {
  it("sends a sensitive change to Saad, merges once on his approval of that head, and gives a refused merge's approval back", async () => {
    const t = setup({ files: [[".github/workflows/ci.yml", "on: push\n"]] });
    setMergeApprovals(true);
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /Escalated to Saad: PR #50 at [0-9a-f]{7} touches \.github\/workflows\/ci\.yml/
    );
    const [ask] = openAsks(t.w);
    expect(ask).toMatchObject({ subject: "pr:o/r#50", sha: t.sha });
    answerAsk(t.w, ask.id, { action: "approve" });

    refuseMerge = "GitHub refused";
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /GitHub refused/
    );
    expect(getAsk(t.w, ask.id)?.used_at).toBeNull();

    refuseMerge = null;
    await expect(runTool(t.w, "sign_off", { task: "#50" })).resolves.toBe(
      `Merged o/r#50: squash-merged at ${t.sha.slice(0, 7)}.`
    );
    expect(merges).toHaveLength(1);
    expect(merges[0]).toContain(t.sha);
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /is with Saad/
    );
  });

  it("links an ask_saad merge decision to the PR's head and merges it once on his approval", async () => {
    const t = setup();
    await expect(
      runTool(t.w, "ask_saad", {
        title: "Merge o/r#50 without its review?",
        detail: "Dispatch reviewed it its own way.",
        kind: "decision",
        task: "o/r#50",
        sha: t.sha.slice(0, 8),
      })
    ).resolves.toMatch(/sign_off merges it once/);
    const [ask] = openAsks(t.w);
    expect(ask).toMatchObject({
      subject: "pr:o/r#50",
      kind: "gate",
      sha: t.sha,
    });
    expect(ask.detail).toMatch(
      /AgentOS: PR #50 at [0-9a-f]{7} changes 1 file; review: none yet/
    );
    answerAsk(t.w, ask.id, { action: "approve" }, t.sha);
    await expect(runTool(t.w, "sign_off", { task: "#50" })).resolves.toBe(
      `Merged o/r#50: squash-merged at ${t.sha.slice(0, 7)}.`
    );
    expect(merges).toHaveLength(1);
    expect(getAsk(t.w, ask.id)?.used_at).toBeTruthy();
  });

  it("releases a claim a restart cut off", () => {
    const t = setup();
    const id = Number(
      db
        .prepare(
          `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title, sha, status, used_at)
           VALUES (?, 'pr:o/r#50', 'gate', 'Merge o/r#50?', ?, 'approved', datetime('now'))`
        )
        .run(t.w, t.sha).lastInsertRowid
    );
    expect(releaseInterruptedClaims()).toBeGreaterThanOrEqual(1);
    expect(getAsk(t.w, id)?.used_at).toBeNull();
    expect(spendApproval(id)).toBe(true);
  });
});

describe("the code-review stand-in", () => {
  it("covers only the head it reviewed, and never a blocking review", async () => {
    const t = setup();
    const blocking = async () => ({
      verdict: "block",
      summary: "Bug.",
      findings: [{ severity: "blocking", summary: "off by one" }],
    });
    await reviewTarget(t.w, "#50", { wait: true, claude: blocking });
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      /code-review: not yet, .*stands in for it, and it has blocking findings/
    );
    db.exec(`DELETE FROM orchestrator_gate_failures`);
    await reviewTarget(t.w, "#50", {
      wait: true,
      fresh: true,
      claude: passing,
    });
    // A new head since: the old pass doesn't cover it.
    git(t.repo, "checkout", "-q", "ws-wor-52");
    const next = commit(t.repo, "src/b.ts", "export const b = 2;\n");
    git(t.repo, "checkout", "-q", "main");
    pr = { ...pr!, headRefOid: next };
    putCheck({
      workspaceId: t.w,
      sessionId: "pr:o/r#50",
      sha: next,
      kind: "ci",
      status: "pass",
      detail: JSON.stringify({ count: 1, at: 0 }),
    });
    await expect(runTool(t.w, "sign_off", { task: "#50" })).rejects.toThrow(
      new RegExp(`stands in for it: call review`)
    );
    expect(merges).toEqual([]);
  });
});

describe("parsing", () => {
  it("reads PR refs, GitHub remotes and folder names strictly", () => {
    expect(parsePRRef("#12")).toEqual({ slug: null, number: 12 });
    expect(parsePRRef("O/R#12")).toEqual({ slug: "o/r", number: 12 });
    expect(parsePRRef("pr:o/r#12")).toEqual({ slug: "o/r", number: 12 });
    expect(parsePRRef("https://github.com/o/r/pull/12/files")).toEqual({
      slug: "o/r",
      number: 12,
    });
    expect(parsePRRef("o/r#12 x")).toBeNull();
    expect(parsePRRef("http://github.com/o/r/pull/12")).toBeNull();
    expect(slugOfRemote("git@github.com:O/R.git")).toBe("o/r");
    expect(slugOfRemote("ssh://git@github.com/o/r")).toBe("o/r");
    expect(slugOfRemote("https://github.com/o/r.git")).toBe("o/r");
    expect(slugOfRemote("https://github.com.evil.com/o/r")).toBeNull();
    expect(slugOfRemote("https://gitlab.com/o/r")).toBeNull();
    expect(
      namedAfter("/home/x/.dispatch/workstak-app--ws-1", "workstak-app")
    ).toBe(true);
    expect(namedAfter("/home/x/workstak-application", "workstak-app")).toBe(
      false
    );
  });
});
