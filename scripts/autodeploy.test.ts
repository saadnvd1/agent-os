import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";

// Runs the real scripts/autodeploy in a scratch clone with a stub redeploy
// (a pull) and wait-quiet, against a scratch origin and HOME.
const script = path.resolve(__dirname, "autodeploy");
const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

function setup() {
  const root = tempDir("aos-autodeploy-");
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  const clone = path.join(root, "live");
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  sh(root, "init", "-q", "--bare", "-b", "main", origin);
  sh(root, "clone", "-q", origin, work);
  fs.mkdirSync(path.join(work, "scripts"));
  fs.copyFileSync(script, path.join(work, "scripts/autodeploy"));
  fs.mkdirSync(path.join(work, "scripts/lib"));
  for (const f of ["sync-cli-links", "lib/cli-links.sh"])
    fs.copyFileSync(path.join(__dirname, f), path.join(work, "scripts", f));
  fs.chmodSync(path.join(work, "scripts/sync-cli-links"), 0o755);
  fs.mkdirSync(path.join(work, "bin"));
  fs.writeFileSync(path.join(work, "bin/aos"), "");
  fs.writeFileSync(path.join(work, "scripts/wait-quiet"), "#!/bin/sh\n");
  fs.writeFileSync(
    path.join(work, "scripts/redeploy"),
    "#!/bin/sh\ngit pull -q origin main && echo x >> ../restarts\n"
  );
  fs.chmodSync(path.join(work, "scripts/autodeploy"), 0o755);
  fs.chmodSync(path.join(work, "scripts/wait-quiet"), 0o755);
  fs.chmodSync(path.join(work, "scripts/redeploy"), 0o755);
  const commit = (msg: string) => {
    fs.appendFileSync(path.join(work, "f"), msg + "\n");
    sh(work, "add", "-A");
    sh(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", msg);
    sh(work, "push", "-q", "origin", "main");
    return sh(work, "rev-parse", "HEAD");
  };
  commit("first");
  sh(root, "clone", "-q", origin, clone);
  const state = path.join(home, ".agent-os/autodeploy");
  const run = () =>
    execFileSync(path.join(clone, "scripts/autodeploy"), [], {
      cwd: clone,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: home,
        AGENTOS_PUBLISH: "0",
        AGENTOS_SETTLE: "0",
        AGENTOS_RESTART: "true",
        AOS_BIN_DIR: path.join(root, "linkbin"),
        AGENT_OS_HOME: path.join(home, ".agent-os"),
      },
    });
  const restarts = () => {
    try {
      return (
        fs.readFileSync(path.join(root, "restarts"), "utf-8").split("\n")
          .length - 1
      );
    } catch {
      return 0;
    }
  };
  const deployed = () =>
    fs.readFileSync(path.join(state, "deployed"), "utf-8").trim();
  return { root, clone, commit, run, restarts, deployed, state };
}

describe("autodeploy restart gap", () => {
  it("holds a second deploy inside the gap, then deploys the newest head once it ends", () => {
    const t = setup();
    const a = t.commit("a");
    expect(t.run()).toContain("Deploying");
    expect(t.deployed()).toBe(a);
    expect(t.restarts()).toBe(1);

    t.commit("b");
    const c = t.commit("c");
    const held = t.run();
    expect(held).toMatch(/HELD [0-9a-f]{7} \d+s left in the 3600s restart gap/);
    expect(t.deployed()).toBe(a);
    expect(t.restarts()).toBe(1);
    // Still waiting a minute later: no second log line for the same head.
    expect(t.run()).toBe("");

    // The gap ends: the head that was waiting goes out, once.
    fs.writeFileSync(
      path.join(t.state, "restarted"),
      `${Math.floor(Date.now() / 1000) - 3601}\n`
    );
    expect(t.run()).toContain("Deploying");
    expect(t.deployed()).toBe(c);
    expect(t.restarts()).toBe(2);
    expect(t.run()).toBe("");
  });

  it("skips the gap for a [deploy-now] commit", () => {
    const t = setup();
    t.commit("a");
    t.run();
    const urgent = t.commit("fix: login loop [deploy-now]");
    expect(t.run()).toContain("[deploy-now]");
    expect(t.deployed()).toBe(urgent);
    expect(t.restarts()).toBe(2);
  });
});

describe("autodeploy changelog commits", () => {
  const changelog = (t: ReturnType<typeof setup>, also?: string) => {
    const work = path.join(t.root, "work");
    fs.mkdirSync(path.join(work, "content"), { recursive: true });
    fs.writeFileSync(path.join(work, "content/whats-new.json"), "{}\n");
    if (also) fs.appendFileSync(path.join(work, "f"), also + "\n");
    sh(work, "add", "-A");
    sh(
      work,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-qm",
      "chore(whats-new): add 1 entries"
    );
    sh(work, "push", "-q", "origin", "main");
    return sh(work, "rev-parse", "HEAD");
  };

  it("pulls a commit that touches only the changelog without a restart", () => {
    const t = setup();
    const a = t.commit("a");
    t.run();
    expect(t.restarts()).toBe(1);

    const b = changelog(t);
    expect(t.run()).toBe("");
    expect(t.deployed()).toBe(b);
    expect(t.deployed()).not.toBe(a);
    expect(t.restarts()).toBe(1);
    expect(fs.existsSync(path.join(t.clone, "content/whats-new.json"))).toBe(
      true
    );
    expect(t.run()).toBe("");
  });

  it("still redeploys a commit that touches the changelog and something else", () => {
    const t = setup();
    t.commit("a");
    t.run();
    const c = changelog(t, "more");
    fs.writeFileSync(
      path.join(t.state, "restarted"),
      `${Math.floor(Date.now() / 1000) - 3601}\n`
    );
    expect(t.run()).toContain("Deploying");
    expect(t.deployed()).toBe(c);
    expect(t.restarts()).toBe(2);
  });
});

describe("autodeploy CLI links", () => {
  it("repoints a link into another clone at the live checkout after a deploy", () => {
    const t = setup();
    const stale = path.join(t.root, "old/bin/aos");
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, "");
    const linkbin = path.join(t.root, "linkbin");
    fs.mkdirSync(linkbin);
    fs.symlinkSync(stale, path.join(linkbin, "aos"));
    fs.mkdirSync(path.join(t.root, "home/.agent-os"), { recursive: true });
    fs.writeFileSync(
      path.join(t.root, "home/.agent-os/live-server.json"),
      JSON.stringify({ cwd: t.clone })
    );
    t.commit("a");
    expect(t.run()).toContain("repointed");
    expect(fs.readlinkSync(path.join(linkbin, "aos"))).toBe(
      path.join(t.clone, "bin/aos")
    );
  });
});
