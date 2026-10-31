import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";

// The real scripts/update-run.mjs and scripts/redeploy on a scratch clone of
// a scratch remote: install and build are stubs, and the "server" is a tiny
// node script the restart command starts, answering health with the commit
// it was started from. A commit carrying a `crash` file makes it exit on
// boot, so the update has to roll itself back.
const exec = promisify(execFile);
const here = import.meta.dirname;
const SCRIPTS = [
  "redeploy",
  "update-run.mjs",
  "lib/build-swap.sh",
  "lib/pnpm.sh",
  "lib/deps-swap.sh",
  "lib/update-verify.mjs",
];

const SERVER = `
const http = require("http");
const fs = require("fs");
const { execSync } = require("child_process");
if (fs.existsSync("crash")) process.exit(1);
const build = execSync("git rev-parse HEAD").toString().trim();
const startedAt = new Date().toISOString();
http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/updates/health")
    return res.end(JSON.stringify({ ok: true, build, startedAt, migrations: { known: 1, applied: 1 } }));
  res.end("{}");
}).listen(Number(process.env.PORT), "127.0.0.1");
`;

let root: string;
let live: string;
let port: string;

// Nothing of the machine's git config: no global identity or default branch
// to lean on, as on a CI runner. Every git here and in the scripts under
// test gets this environment.
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  }).trim();
const commit = (cwd: string, msg: string) => {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "--allow-empty", "-m", msg);
  git(cwd, "push", "-q", "origin", "HEAD:main");
  return git(cwd, "rev-parse", "HEAD");
};

const freePort = () =>
  new Promise<string>((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(String(p)));
    });
  });

const health = async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/updates/health`);
    return ((await res.json()) as { build: string }).build;
  } catch {
    return null;
  }
};

beforeEach(async () => {
  root = tempDir("aos-e2e-");
  port = await freePort();
  const origin = path.join(root, "origin.git");
  const src = path.join(root, "src");
  live = path.join(root, "live");
  git(root, "init", "-q", "-b", "main", "--bare", origin);
  git(root, "init", "-q", "-b", "main", src);
  git(src, "remote", "add", "origin", origin);
  for (const f of SCRIPTS) {
    fs.mkdirSync(path.dirname(path.join(src, "scripts", f)), {
      recursive: true,
    });
    fs.copyFileSync(path.join(here, f), path.join(src, "scripts", f));
  }
  fs.chmodSync(path.join(src, "scripts/redeploy"), 0o755);
  fs.writeFileSync(path.join(src, "server.js"), SERVER);
  for (const f of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
    fs.writeFileSync(path.join(src, f), "{}");
  fs.writeFileSync(
    path.join(src, ".gitignore"),
    ".next*\n.deps\nnode_modules\n*.log\n"
  );
  commit(src, "first");
  git(root, "clone", "-q", origin, live);
  fs.mkdirSync(path.join(live, ".next"));
  fs.writeFileSync(path.join(live, ".next/BUILD_ID"), "first");
  fs.mkdirSync(path.join(root, "bin"));
  fs.writeFileSync(path.join(root, "bin/pnpm"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  // Stop the server on the port (if any), then start this checkout's.
  fs.writeFileSync(
    path.join(root, "restart"),
    `#!/usr/bin/env bash
[ -f "${root}/pid" ] && kill "$(cat "${root}/pid")" 2>/dev/null
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:${port}/" || break; sleep 0.1; done
cd "${live}" || exit 1
nohup node server.js > "${root}/server.log" 2>&1 < /dev/null &
echo $! > "${root}/pid"
`,
    { mode: 0o755 }
  );
  execFileSync(path.join(root, "restart"), {
    env: { ...process.env, ...GIT_ENV, PORT: port },
  });
  for (let i = 0; i < 50 && !(await health()); i++)
    await new Promise((r) => setTimeout(r, 100));
});

afterEach(() => {
  try {
    process.kill(Number(fs.readFileSync(path.join(root, "pid"), "utf8")));
  } catch {}
});

async function update(from: string, to: string) {
  const stateFile = path.join(root, "state.json");
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      id: "e2e",
      phase: "starting",
      from,
      startedAt: Date.now(),
    })
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...GIT_ENV,
    HOME: root,
    PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
    PORT: port,
    AGENTOS_UPDATE_STATE: stateFile,
    AGENTOS_RESTART: path.join(root, "restart"),
    AGENTOS_UPDATE_TO: to,
    AGENTOS_INSTALL_CMD: "mkdir -p node_modules",
    AGENTOS_NATIVE_CHECK: "true",
    AGENTOS_BUILD_CMD:
      'mkdir -p "$AGENTOS_DIST_DIR" && git rev-parse HEAD > "$AGENTOS_DIST_DIR/BUILD_ID"',
    AGENTOS_UP_WAIT: "3",
    AGENTOS_UPDATE_MIN_FREE_GB: "0",
    AGENTOS_VERIFY_UP_MS: "5000",
    AGENTOS_VERIFY_EVERY_MS: "50",
    AGENTOS_VERIFY_CHECKS: "2",
  };
  for (const k of [
    "AGENTOS_UPDATE_DB",
    "AGENTOS_UPDATE_ROOT",
    "AGENTOS_UPDATE_REDEPLOY",
    "NODE_ENV",
  ])
    delete env[k];
  await exec(process.execPath, [path.join(live, "scripts/update-run.mjs")], {
    env,
    timeout: 60_000,
  }).catch(() => {});
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

describe("an automatic update, end to end", () => {
  it("updates to a good commit, then rolls back one whose server won't start", async () => {
    const src = path.join(root, "src");
    const first = git(live, "rev-parse", "HEAD");
    expect(await health()).toBe(first);

    fs.writeFileSync(path.join(src, "feature.txt"), "good");
    const good = commit(src, "good");
    // A newer head the update must not take: it is pinned to `good`.
    fs.writeFileSync(path.join(src, "later.txt"), "later");
    commit(src, "later");
    const s1 = await update(first, good);
    expect(s1).toMatchObject({ phase: "done", outcome: "done" });
    expect(git(live, "rev-parse", "HEAD")).toBe(good);
    expect(await health()).toBe(good);
    expect(
      fs.readFileSync(path.join(live, ".next/BUILD_ID"), "utf8").trim()
    ).toBe(good);

    fs.writeFileSync(path.join(src, "crash"), "");
    const bad = commit(src, "bad");
    const s2 = await update(good, bad);
    expect(s2).toMatchObject({ phase: "rolled_back", outcome: "rolled_back" });
    expect(git(live, "rev-parse", "HEAD")).toBe(good);
    expect(fs.existsSync(path.join(live, "crash"))).toBe(false);
    expect(
      fs.readFileSync(path.join(live, ".next/BUILD_ID"), "utf8").trim()
    ).toBe(good);
    expect(await health()).toBe(good);
  }, 90_000);
});
