#!/usr/bin/env node
// Load test: N idle terminal sessions under a throwaway AgentOS, then what the
// server costs at rest.
//
//   node scripts/perf/loadtest.mjs [--sessions 100] [--busy 5] [--viewers 1]
//        [--terminals 3] [--warmup 30] [--seconds 30] [--dev] [--legacy] [--json]
//
// Everything is private to the run: its own HOME, database, port and tmux
// server (TMUX_TMPDIR), torn down at the end. It never touches the AgentOS you
// use. `--busy` sessions print a line a second, `--viewers` hold /ws/status
// open like browser tabs, `--terminals` attach to the first sessions. Spawn
// counting needs passwordless sudo (see execs.mjs); without it that number is
// skipped. It runs the production build (`next build` first); `--dev` runs
// the dev server instead, whose file watcher inflates the fd count.
//
// Run it on a machine with room to spare, not the one you're working on.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { WebSocket } from "ws";
import { countExecs } from "./execs.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return Number(i > 0 ? process.argv[i + 1] : fallback);
};
const N = arg("sessions", 100);
const BUSY = arg("busy", 5);
const VIEWERS = arg("viewers", 1);
const TERMINALS = arg("terminals", 3);
const WARMUP = arg("warmup", 30);
const SECONDS = arg("seconds", 30);
const asJson = process.argv.includes("--json");
const DEV = process.argv.includes("--dev");
// Viewers take the numbered stream, as the web app does; --legacy asks for
// the whole map on every change instead.
const LEGACY = process.argv.includes("--legacy");

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-load-"));
const home = path.join(dir, "home");
const tmuxDir = path.join(dir, "tmux");
fs.mkdirSync(home);
fs.mkdirSync(tmuxDir);
const port = 20000 + Math.floor(Math.random() * 20000);
const env = {
  ...process.env,
  HOME: home,
  TMUX_TMPDIR: tmuxDir,
  DB_PATH: path.join(dir, "agent-os.db"),
  PORT: String(port),
  AGENTOS_BIND: "127.0.0.1",
  AGENTOS_TAILNET_HTTPS: "0",
  AGENTOS_SCHEDULES: "off",
  AGENTOS_STACKS: "off",
  AGENTOS_AUTH: "off",
  NODE_ENV: DEV ? "development" : "production",
};
delete env.TMUX;
const log = (...a) => !asJson && console.error("·", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Always this run's own server, by its socket: inside a tmux pane $TMUX would
// otherwise win over TMUX_TMPDIR and point at the real one.
const socket = path.join(tmuxDir, `tmux-${process.getuid()}`, "default");
const tmux = (...args) => {
  if (!socket.startsWith(dir + path.sep))
    throw new Error(`refusing tmux socket ${socket}`);
  return execFileSync("tmux", ["-S", socket, ...args], {
    env,
    stdio: "pipe",
  }).toString();
};

let server;
const sockets = [];
async function teardown() {
  for (const ws of sockets) ws.terminate();
  try {
    tmux("kill-server");
  } catch {}
  const signal = (sig) => {
    try {
      process.kill(-server.pid, sig);
    } catch {}
  };
  if (server && server.exitCode === null) {
    signal("SIGTERM");
    await sleep(1000);
    if (server.exitCode === null) signal("SIGKILL");
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
process.on("SIGINT", () => teardown().then(() => process.exit(130)));

function descendants(root) {
  const out = execFileSync("ps", ["-Ao", "pid=,ppid=,rss=,comm="]).toString();
  const rows = out
    .trim()
    .split("\n")
    .map((l) => {
      const [pid, ppid, rss, ...comm] = l.trim().split(/\s+/);
      return { pid: +pid, ppid: +ppid, rss: +rss, comm: comm.join(" ") };
    });
  const kids = new Map();
  for (const r of rows) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), r]);
  const all = [];
  const walk = (pid) =>
    (kids.get(pid) ?? []).forEach((r) => (all.push(r), walk(r.pid)));
  walk(root);
  return { all, self: rows.find((r) => r.pid === root) };
}

function fdCount(pid) {
  if (process.platform === "linux")
    return fs.readdirSync(`/proc/${pid}/fd`).length;
  return (
    execFileSync("lsof", ["-p", String(pid)])
      .toString()
      .trim()
      .split("\n").length - 1
  );
}

// The node process doing the work: tsx's launcher is a parent that only waits.
function serverPid() {
  const { all } = descendants(server.pid);
  const node = all.filter((r) => /node/.test(r.comm));
  return (
    node.find((r) =>
      all.every((o) => o.ppid !== r.pid || !/node/.test(o.comm))
    ) ??
    node.at(-1) ?? { pid: server.pid }
  ).pid;
}

// Processes AgentOS keeps for its sessions that aren't its children: what
// tmux runs for it (pipe-pane taps: sh, cat, nc), found by this run's paths
// on their command lines, with what runs under them. The panes' own shells
// don't name them.
function helpers(exclude) {
  const rows = execFileSync("ps", ["-Ao", "pid=,ppid=,command="])
    .toString()
    .trim()
    .split("\n")
    .map((l) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
      return m ? { pid: +m[1], ppid: +m[2], cmd: m[3] } : null;
    })
    .filter(Boolean);
  const found = new Set(
    rows
      .filter((r) => r.cmd.includes(dir) && !/tmux -S /.test(r.cmd))
      .filter((r) => !exclude.has(r.pid) && !/\bps -Ao\b/.test(r.cmd))
      .map((r) => r.pid)
  );
  for (const r of rows)
    if (found.has(r.ppid) && !exclude.has(r.pid)) found.add(r.pid);
  return [...found];
}

function sample(pid) {
  const { all, self } = descendants(pid);
  const byName = {};
  for (const r of all) byName[r.comm] = (byName[r.comm] ?? 0) + 1;
  const mine = new Set(all.map((r) => r.pid));
  const tapped = helpers(mine);
  return {
    rssMiB: Math.round((self?.rss ?? 0) / 1024),
    fds: fdCount(pid),
    childProcesses: all.length,
    children: byName,
    // Children plus what tmux runs on its behalf.
    sessionProcesses: all.length + tapped.length,
  };
}

async function main() {
  log(`dir ${dir}, port ${port}`);
  server = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: repo,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  server.stdout.on("data", (d) => {
    if (String(d).includes("ready on")) ready = true;
  });
  server.stderr.on(
    "data",
    (d) => process.env.LOADTEST_VERBOSE && process.stderr.write(d)
  );
  for (let i = 0; !ready; i++) {
    if (server.exitCode !== null)
      throw new Error("server exited during startup");
    if (i > 240) throw new Error("server not ready after 120s");
    await sleep(500);
  }
  log("server ready");

  const db = new Database(env.DB_PATH);
  db.pragma("busy_timeout = 10000");
  const insert = db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, agent_type, host_id)
     VALUES (?, ?, ?, ?, 'claude', 'local')`
  );
  for (let i = 0; i < N; i++) {
    const name = `load-${i}`;
    insert.run(
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name,
      name,
      home
    );
    const loop =
      i < BUSY
        ? "while :; do date; sleep 1; done"
        : "while :; do sleep 3600; done";
    tmux(
      "new-session",
      "-d",
      "-s",
      name,
      "-x",
      "120",
      "-y",
      "40",
      "sh",
      "-c",
      loop
    );
  }
  db.close();
  log(`${N} sessions (${BUSY} busy)`);

  const base = `ws://127.0.0.1:${port}`;
  const open = (url) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { origin: `http://127.0.0.1:${port}` });
      sockets.push(ws);
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  let statusBytes = 0;
  let lastStatuses = {};
  let statusMessages = 0;
  for (let i = 0; i < VIEWERS; i++) {
    const ws = await open(`${base}/ws/status${LEGACY ? "" : "?v=2"}`);
    ws.on("message", (d) => {
      statusBytes += d.length;
      statusMessages++;
      try {
        const m = JSON.parse(String(d));
        // A whole map (a snapshot, or a server without the stream) or a delta.
        if (m.statuses) lastStatuses = { ...m.statuses };
        else if (m.type === "statuses") {
          Object.assign(lastStatuses, m.changed);
          for (const id of m.removed ?? []) delete lastStatuses[id];
        }
      } catch {}
    });
  }
  let terminalBytes = 0;
  for (let i = 0; i < Math.min(TERMINALS, N); i++) {
    const ws = await open(`${base}/ws/terminal`);
    ws.on("message", (d) => (terminalBytes += d.length));
    ws.send(
      JSON.stringify({
        type: "attach",
        spec: { sessionName: `load-${i}`, attachOnly: true },
      })
    );
  }
  log(
    `${VIEWERS} status viewers, ${TERMINALS} terminals; warming up ${WARMUP}s`
  );
  await sleep(WARMUP * 1000);

  const pid = serverPid();
  statusBytes = statusMessages = terminalBytes = 0;
  const before = sample(pid);
  let execs = null;
  try {
    execFileSync("sudo", ["-n", "true"], { stdio: "ignore" });
    execs = await countExecs(pid, SECONDS);
  } catch {
    await sleep(SECONDS * 1000);
  }
  const after = sample(pid);
  const perMin = (n) => Math.round((n * 60) / SECONDS);
  const result = {
    platform: process.platform,
    sessions: N,
    busy: BUSY,
    viewers: VIEWERS,
    terminals: TERMINALS,
    rssMiB: after.rssMiB,
    fds: after.fds,
    childProcesses: after.childProcesses,
    sessionProcesses: after.sessionProcesses,
    children: after.children,
    spawnsPerMinute: execs?.perMinute ?? null,
    topSpawns: execs?.rows.slice(0, 8) ?? null,
    statusMessagesPerMinute: perMin(statusMessages),
    statusKiBPerMinute: Math.round(perMin(statusBytes) / 1024),
    terminalKiBPerMinute: Math.round(perMin(terminalBytes) / 1024),
    // What the server says the sessions are doing: the busy ones print.
    statusCounts: Object.values(lastStatuses).reduce((n, s) => {
      n[s.status] = (n[s.status] ?? 0) + 1;
      return n;
    }, {}),
    rssGrowthMiB: after.rssMiB - before.rssMiB,
  };
  if (asJson) console.log(JSON.stringify(result));
  else console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(teardown);
