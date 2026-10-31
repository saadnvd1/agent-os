#!/usr/bin/env node
// Runs one update, started detached by the server so it survives the restart.
// Backs the database up, runs scripts/redeploy, follows its "::phase" and
// "::stage" lines into the state file the server and the browser read, then
// checks the restarted server and, when it isn't healthy, rolls back.
//   AGENTOS_UPDATE_STATE  the state file (JSON, written atomically)
//   AGENTOS_RESTART       the restart command; none means "built, restart it yourself"
//   AGENTOS_UPDATE_TO     the commit to update to (default: the remote's head)
//   AGENTOS_UPDATE_DB     the database to back up first, into AGENTOS_UPDATE_BACKUPS
//   AGENTOS_UPDATE_VERIFY=0  skip the health check (tests)
//   AGENTOS_UPDATE_REDEPLOY  the script to run (tests); default scripts/redeploy
//   AGENTOS_UPDATE_ROOT   the checkout (tests); default this script's
// Outcomes: done, built, build_failed (live server untouched), rolled_back,
// broken (the rollback didn't come up either).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { verifyServer } from "./lib/update-verify.mjs";

const env = process.env;
const file = env.AGENTOS_UPDATE_STATE;
if (!file) {
  console.error("AGENTOS_UPDATE_STATE is not set");
  process.exit(2);
}
const root =
  env.AGENTOS_UPDATE_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script =
  env.AGENTOS_UPDATE_REDEPLOY || path.join(root, "scripts/redeploy");
const PHASES = new Set(["pulling", "installing", "building", "restarting"]);
const STAGES = ["pulled", "deps_swapped", "build_swapped"];
const KEEP_BACKUPS = 3;

function read() {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function write(patch) {
  const run = { ...(read() ?? {}), ...patch, updatedAt: Date.now() };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(run));
  fs.renameSync(tmp, file);
}

const tail = [];
const keep = (line) => {
  tail.push(line);
  if (tail.length > 30) tail.shift();
};
const say = (line) => {
  keep(line);
  console.log(line);
};

const finish = (phase, outcome, error) =>
  write({
    phase,
    outcome,
    finishedAt: Date.now(),
    log: tail,
    ...(error ? { error } : {}),
  });

/** Runs redeploy with args; resolves its exit code and the furthest stage. */
function redeploy(args) {
  return new Promise((resolve) => {
    let stage = null;
    const child = spawn("bash", [script, ...args], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      readline.createInterface({ input: stream }).on("line", (line) => {
        const p = /^::phase (\w+)$/.exec(line);
        if (p && PHASES.has(p[1])) return write({ phase: p[1] });
        const s = /^::stage (\w+)$/.exec(line);
        if (s && STAGES.includes(s[1])) {
          stage = s[1];
          return write({ stage });
        }
        say(line);
      });
    }
    child.on("error", (error) => {
      say(error.message);
      resolve({ code: -1, stage });
    });
    child.on("close", (code) => resolve({ code: code ?? -1, stage }));
  });
}

async function backup() {
  const db = env.AGENTOS_UPDATE_DB;
  const dir = env.AGENTOS_UPDATE_BACKUPS;
  if (!db || !dir || !fs.existsSync(db)) return;
  write({ phase: "backing_up" });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const from = String(read()?.from ?? "").slice(0, 7) || "unknown";
  const out = path.join(dir, `agent-os-${stamp}-update-${from}.db`);
  // Loaded from this checkout before the install swaps node_modules.
  const { default: Sqlite } = await import(
    path.join(root, "node_modules/better-sqlite3/lib/index.js")
  );
  const src = new Sqlite(db, { readonly: true, fileMustExist: true });
  try {
    // The online backup copies pages between the server's writes.
    await src.backup(out);
  } finally {
    src.close();
  }
  fs.chmodSync(out, 0o600);
  say(`Backed up the database to ${path.basename(out)}`);
  const old = fs
    .readdirSync(dir)
    .filter((f) => /^agent-os-\d{8}T\d{6}-update-\w+\.db$/.test(f))
    .sort()
    .slice(0, -KEEP_BACKUPS);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
}

const head = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

/** A pull that never got built in is undone, so source and build agree. */
function resetSource(from) {
  if (!from || head() === from) return;
  try {
    execFileSync("git", ["reset", "-q", "--keep", from], { cwd: root });
    say(`Put the source back to ${from.slice(0, 7)}.`);
  } catch (error) {
    say(
      `Couldn't put the source back to ${from.slice(0, 7)}: ${error.message}`
    );
  }
}

async function main() {
  const heartbeat = setInterval(() => write({}), 15_000);
  write({ pid: process.pid });
  const from = read()?.from || head();
  try {
    try {
      await backup();
    } catch (error) {
      return finish(
        "failed",
        "build_failed",
        `Couldn't back up the database first, so nothing was changed: ${error.message}`
      );
    }

    const up = await redeploy([]);
    const swapped = up.stage === "build_swapped";
    if (up.code !== 0 && !swapped) {
      if (up.stage) resetSource(from);
      return finish(
        "failed",
        "build_failed",
        `The update failed (exit ${up.code}). The running server was not changed.`
      );
    }
    if (!env.AGENTOS_RESTART) return finish("built", "done");

    let why = up.code === 0 ? null : "it didn't come back after the restart";
    if (!why && env.AGENTOS_UPDATE_VERIFY !== "0") {
      write({ phase: "verifying" });
      const ok = await verifyServer({
        port: env.PORT || "3011",
        expect: env.AGENTOS_UPDATE_TO || head(),
        env,
      });
      if (!ok.ok) why = ok.why;
    }
    if (!why) return finish("done", "done");

    say(`The new version isn't healthy: ${why}. Rolling back.`);
    write({ phase: "rolling_back", error: why });
    const back = await redeploy(
      from ? ["--rollback", "--to", from] : ["--rollback"]
    );
    let backOk = back.code === 0;
    if (backOk && env.AGENTOS_UPDATE_VERIFY !== "0") {
      const ok = await verifyServer({
        port: env.PORT || "3011",
        expect: from,
        env,
      });
      if (!ok.ok) {
        backOk = false;
        say(`The rolled-back version isn't healthy either: ${ok.why}`);
      }
    }
    return backOk
      ? finish(
          "rolled_back",
          "rolled_back",
          `The new version wasn't healthy (${why}), so AgentOS went back to the previous one.`
        )
      : finish(
          "failed",
          "broken",
          `The new version wasn't healthy (${why}) and rolling back didn't work either. See the update log; scripts/redeploy --rollback puts the previous build back.`
        );
  } finally {
    clearInterval(heartbeat);
  }
}

main().catch((error) => finish("failed", "build_failed", error.message));
