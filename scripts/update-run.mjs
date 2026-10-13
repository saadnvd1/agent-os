#!/usr/bin/env node
// Runs one update, started detached by the server so it survives the restart.
// Runs scripts/redeploy, follows its "::phase <name>" lines into the state
// file the server and the browser read, and writes how it ended.
//   AGENTOS_UPDATE_STATE  the state file (JSON, written atomically)
//   AGENTOS_RESTART       the restart command; none means "built, restart it yourself"
//   AGENTOS_UPDATE_REDEPLOY  the script to run (tests); default scripts/redeploy
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const file = process.env.AGENTOS_UPDATE_STATE;
if (!file) {
  console.error("AGENTOS_UPDATE_STATE is not set");
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script =
  process.env.AGENTOS_UPDATE_REDEPLOY || path.join(root, "scripts/redeploy");
const PHASES = new Set(["pulling", "installing", "building", "restarting"]);

function read() {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function write(patch) {
  const run = { ...(read() ?? {}), ...patch };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(run));
  fs.renameSync(tmp, file);
}

const tail = [];
const keep = (line) => {
  tail.push(line);
  if (tail.length > 30) tail.shift();
};

const child = spawn("bash", [script], {
  cwd: root,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [child.stdout, child.stderr]) {
  readline.createInterface({ input: stream }).on("line", (line) => {
    const m = /^::phase (\w+)$/.exec(line);
    if (m && PHASES.has(m[1])) return write({ phase: m[1] });
    keep(line);
    console.log(line);
  });
}
child.on("error", (error) =>
  write({
    phase: "failed",
    finishedAt: Date.now(),
    error: error.message,
    log: tail,
  })
);
child.on("close", (code) => {
  // The server may have marked this done already when it came back up.
  const phase = read()?.phase;
  if (code === 0) {
    write({
      phase: process.env.AGENTOS_RESTART ? "done" : "built",
      finishedAt: Date.now(),
      log: tail,
    });
  } else if (phase !== "done") {
    write({
      phase: "failed",
      finishedAt: Date.now(),
      error: `The update failed (exit ${code}). The running server was not changed unless it says otherwise below.`,
      log: tail,
    });
  }
});
