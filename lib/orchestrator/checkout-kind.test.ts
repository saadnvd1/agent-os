import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { afterAll, describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";

const home = fs.realpathSync(tempDir("aos-kind-"));
process.env.HOME = home;
process.env.AGENT_OS_HOME = path.join(home, ".agent-os");
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

const { createProject } = await import("@/lib/projects");
const { createWorkspace, setProjectWorkspace } =
  await import("@/lib/workspaces");
const { checkoutKind } = await import("./write-guard");
const { writeLiveRecord } = await import("@/lib/dev-instance/liveServer");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" });
const repoAt = (name: string) => {
  const dir = path.join(home, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  return dir;
};

const mine = repoAt("mine");
const theirs = repoAt("theirs");
const live = repoAt("live");
const deploy = repoAt("deploy");
fs.mkdirSync(path.join(deploy, "scripts"));
fs.writeFileSync(path.join(deploy, "scripts", "autodeploy"), "#!/bin/sh\n");
const task = path.join(home, "task-wt");
git(
  deploy,
  "-c",
  "user.name=t",
  "-c",
  "user.email=t@t",
  "commit",
  "-q",
  "--allow-empty",
  "-m",
  "x"
);
git(deploy, "worktree", "add", "-q", "-b", "t", task);
const link = path.join(home, "link-to-mine");
fs.symlinkSync(mine, link);

const ws = createWorkspace("kind-mine");
const other = createWorkspace("kind-theirs");
setProjectWorkspace(
  createProject({ name: "mine", workingDirectory: mine }).id,
  ws.id
);
setProjectWorkspace(
  createProject({ name: "theirs", workingDirectory: theirs }).id,
  other.id
);
const session = (workspace: string) => ({ workspace_id: workspace }) as never;

describe("checkoutKind", () => {
  it("is own for the workspace's project, also through a symlink and from a subfolder", async () => {
    const s = session(ws.id);
    expect(await checkoutKind(s, mine)).toBe("own");
    expect(await checkoutKind(s, link)).toBe("own");
    expect(await checkoutKind(s, path.join(mine, "src"))).toBe("own");
  });

  it("is other for another workspace's project and unknown folders", async () => {
    const s = session(ws.id);
    expect(await checkoutKind(s, theirs)).toBe("other");
    expect(await checkoutKind(s, home)).toBe("other");
  });

  it("is live for the recorded folder even when its process is dead, and for a main checkout holding scripts/autodeploy", async () => {
    const s = session(ws.id);
    writeLiveRecord(
      { pid: 2 ** 22 + 12345, port: 3011, cwd: live, startedAt: 1 },
      process.env.AGENT_OS_HOME
    );
    expect(await checkoutKind(s, live)).toBe("live");
    expect(await checkoutKind(s, path.join(live, "lib"))).toBe("live");
    expect(await checkoutKind(s, deploy)).toBe("live");
    // A worktree of it is a task's, not the one deployed.
    expect(await checkoutKind(s, task)).toBe("other");
  });
});
