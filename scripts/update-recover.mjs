#!/usr/bin/env node
// Runs before the server starts (npm prestart): repairs an update that was
// cut off (the machine slept, lost power, the runner was killed), so the
// server never starts on half of one.
//   - .next missing between swap_build's two renames: finish the rename.
//   - a run whose runner is gone, stopped at:
//       pulled        → the source goes back to where it was
//       deps_swapped  → the dependencies and the source go back
//       build_swapped → nothing: source, deps and build all agree (new)
//     and the run is marked interrupted, so the next quiet window retries.
// Never fails the start: anything unexpected is logged and left alone.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ACTIVE = new Set([
  "starting",
  "backing_up",
  "pulling",
  "installing",
  "building",
  "restarting",
  "verifying",
  "rolling_back",
]);
const STALE_MS = 2 * 60_000;
const OLD_STALE_MS = 30 * 60_000;

const alive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

/** .next is absent only between two renames; finish whichever was under way. */
export function recoverBuild(root) {
  const live = path.join(root, ".next");
  if (fs.existsSync(path.join(live, "BUILD_ID"))) return null;
  for (const from of [".next-build", ".next-prev"]) {
    const dir = path.join(root, from);
    if (fs.existsSync(path.join(dir, "BUILD_ID"))) {
      if (fs.existsSync(live))
        fs.rmSync(live, { recursive: true, force: true });
      fs.renameSync(dir, live);
      return from;
    }
  }
  return null;
}

/** True when the run is in an active phase and nothing is running it. */
export function isInterrupted(run, now = Date.now()) {
  if (!run || !ACTIVE.has(run.phase)) return false;
  if (run.updatedAt) return now - run.updatedAt > STALE_MS && !alive(run.pid);
  return now - (run.startedAt ?? 0) > OLD_STALE_MS;
}

export function recoverRun(root, stateFile, now = Date.now()) {
  let run;
  try {
    run = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
  if (!isInterrupted(run, now)) return null;
  const done = [];
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
      .toString()
      .trim();
  // Only a run that recorded its stages says what to undo.
  if (
    run.pid &&
    run.from &&
    (run.stage === "pulled" || run.stage === "deps_swapped")
  ) {
    const prev = path.join(root, ".deps/prev");
    if (run.stage === "deps_swapped" && fs.existsSync(prev)) {
      fs.rmSync(path.join(root, "node_modules"), {
        recursive: true,
        force: true,
      });
      fs.renameSync(prev, path.join(root, "node_modules"));
      done.push("dependencies");
    }
    if (git("rev-parse", "HEAD") !== run.from) {
      git("reset", "-q", "--keep", run.from);
      done.push("source");
    }
  }
  const next = {
    ...run,
    phase: "failed",
    outcome: "interrupted",
    finishedAt: now,
    updatedAt: now,
    error:
      "The update was cut off (the computer slept or restarted), so AgentOS stayed on the version it had. It will try again.",
  };
  const tmp = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, stateFile);
  return done;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const root = process.cwd();
  const dir = process.env.DB_PATH
    ? path.dirname(path.resolve(process.env.DB_PATH))
    : root;
  try {
    const moved = recoverBuild(root);
    if (moved) console.log(`Update recovery: put ${moved} back as .next`);
    const undone = recoverRun(root, path.join(dir, "agent-os-update.json"));
    if (undone)
      console.log(
        `Update recovery: marked a cut-off update as interrupted${undone.length ? `; put back the ${undone.join(" and ")}` : ""}`
      );
  } catch (error) {
    console.error("Update recovery skipped:", error.message);
  }
}
