#!/usr/bin/env node
// Count the processes a server spawns, grouped by command line.
//
//   node scripts/perf/execs.mjs --pid <server pid> [--seconds 20] [--json]
//
// Needs passwordless sudo. macOS follows fork and exec events from `eslogger`
// and keeps those whose ancestry reaches --pid; Linux attaches `strace -f` to
// --pid (and so all its threads). Either way a `sh -c tmux ...` counts against the
// server that started it. Args are folded (names, numbers, paths, user@host)
// so the same call for fifty sessions groups as one line.
import { spawn } from "node:child_process";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

export function fold(args) {
  return args
    .map((a) =>
      a
        .replace(/[^\s@]+@[^\s@]+/g, "user@host")
        .replace(/\/(?:[^/\s]+\/)+/g, "…/")
        .replace(/=[A-Za-z0-9_.:-]{3,}/g, "=…")
        .replace(/\b\d+\b/g, "N")
    )
    .join(" ")
    .slice(0, 140);
}

// `execve("/usr/bin/tmux", ["tmux", "ls"], 0x7ff… /* 30 vars */) = 0`
export function straceArgs(line) {
  const m = /execve\("[^"]*", \[(.*?)\](?:\.\.\.)?, /.exec(line);
  if (!m) return null;
  return [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) =>
    x[1].replace(/\\(.)/g, "$1")
  );
}

function darwin(root, onExec) {
  const parent = new Map();
  const ours = (pid) => {
    for (let p = pid, hops = 0; p && hops < 32; p = parent.get(p), hops++)
      if (p === root) return true;
    return false;
  };
  const es = spawn("sudo", ["-n", "eslogger", "exec", "fork"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  readline.createInterface({ input: es.stdout }).on("line", (line) => {
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    const pid = d.process?.audit_token?.pid;
    if (d.event?.fork) {
      parent.set(d.event.fork.child.audit_token.pid, pid);
      return;
    }
    if (!d.event?.exec) return;
    if (!parent.has(pid)) parent.set(pid, d.process.ppid);
    if (ours(pid))
      onExec(d.event.exec.args ?? [d.event.exec.target.executable.path]);
  });
  return es;
}

function linux(root, onExec) {
  const st = spawn(
    "sudo",
    [
      "-n",
      "strace",
      "-f",
      "-qq",
      "-s",
      "256",
      "-e",
      "trace=execve",
      "-e",
      "signal=none",
      "-p",
      String(root),
    ],
    // strace writes to stderr: node's pipes are sockets, which -o can't open.
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  readline.createInterface({ input: st.stderr }).on("line", (line) => {
    if (!line.includes("= 0") && !line.includes("<unfinished")) return;
    const args = straceArgs(line);
    if (args) onExec(args);
  });
  return st;
}

/** Spawns under `pid` for `seconds`: {total, perMinute, rows: [{cmd, n}]}. */
export function countExecs(pid, seconds) {
  const counts = new Map();
  let total = 0;
  const onExec = (args) => {
    const key = fold(args);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  };
  const child =
    process.platform === "darwin" ? darwin(pid, onExec) : linux(pid, onExec);
  return new Promise((resolve) => {
    setTimeout(() => {
      child.kill("SIGINT");
      const perMinute = (n) => Math.round((n * 60) / seconds);
      resolve({
        seconds,
        total,
        perMinute: perMinute(total),
        rows: [...counts]
          .sort((a, b) => b[1] - a[1])
          .map(([cmd, n]) => ({ cmd, perMinute: perMinute(n) })),
      });
    }, seconds * 1000);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  const pid = Number(arg("pid"));
  if (!pid) {
    console.error("usage: execs.mjs --pid <pid> [--seconds 20] [--json]");
    process.exit(2);
  }
  const r = await countExecs(pid, Number(arg("seconds", "20")));
  if (process.argv.includes("--json")) console.log(JSON.stringify(r));
  else {
    console.log(`${r.total} execs in ${r.seconds}s (${r.perMinute}/min)`);
    for (const { cmd, perMinute } of r.rows)
      console.log(`${String(perMinute).padStart(6)}/min  ${cmd}`);
  }
  process.exit(0);
}
