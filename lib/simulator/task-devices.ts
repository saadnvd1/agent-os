/**
 * Booted simulators that belong to a task, shut down when it ends. Two naming
 * schemes: AgentOS's own (`aos-<instance>-<task id>`, from `aos sim`) and the
 * agentos-mobile project's (`agentos-<branch>-<worktree hash>`, from its
 * `npm run sim`). Shut down only: nothing here deletes or erases a device.
 */

import { createHash } from "crypto";
import fs from "fs";
import { db, type Session } from "../db";
import { isRemoteHost } from "../hosts";
import { simulatorAvailable } from "./available";
import {
  deviceNameFor,
  listDevices,
  shutdownByUdid,
  type SimDevice,
} from "./simctl";

// Same as agentos-mobile's scripts/lib/sim-helpers.mjs (slug, simName); the
// two must stay in step.
export const simSlug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export const projectSimName = (
  branch: string | null | undefined,
  worktreePath: string
) =>
  `agentos-${simSlug(branch || "detached") || "detached"}-${createHash("sha1")
    .update(worktreePath)
    .digest("hex")
    .slice(0, 6)}`;

export const FINISHED = new Set(["merged", "dropped", "done"]);

export interface TaskRef {
  id: string;
  branch_name: string | null;
  worktree_path: string | null;
  task_status?: string | null;
}

// The script resolves its worktree through symlinks; the row may not.
export function pathVariants(p: string | null): string[] {
  if (!p) return [];
  try {
    return [...new Set([p, fs.realpathSync(p)])];
  } catch {
    return [p];
  }
}

export function taskDeviceNames(
  t: Pick<TaskRef, "id" | "branch_name">,
  paths: string[]
): string[] {
  return [
    ...new Set([
      deviceNameFor(t.id),
      ...paths.map((p) => projectSimName(t.branch_name, p)),
    ]),
  ];
}

const running = (d: SimDevice) => d.state === "Booted" || d.state === "Booting";

// Running devices whose every matching task is finished: a task re-run on the
// same branch and worktree keeps its device, and unmatched ones are not ours.
export function planFinishedShutdowns(
  devices: SimDevice[],
  tasks: (TaskRef & { paths?: string[] })[]
): SimDevice[] {
  const owners = new Map<string, boolean[]>();
  for (const t of tasks) {
    const finished = FINISHED.has(t.task_status ?? "");
    const paths = t.paths ?? pathVariants(t.worktree_path);
    for (const name of taskDeviceNames(t, paths))
      owners.set(name, [...(owners.get(name) ?? []), finished]);
  }
  return devices.filter((d) => {
    const o = owners.get(d.name);
    return running(d) && !!o && o.every(Boolean);
  });
}

const enabled = () =>
  simulatorAvailable() && process.env.AGENTOS_SIM_SHUTDOWN !== "off";

async function shutAll(devices: SimDevice[], why: string): Promise<number> {
  let n = 0;
  for (const d of devices) {
    try {
      await shutdownByUdid(d.udid);
      n++;
      console.log(`[simulator] shut down ${d.name}: ${why}`);
    } catch (error) {
      console.error(`[simulator] shutdown ${d.name}:`, error);
    }
  }
  return n;
}

// For a task that is ending. Never blocks and never throws into the cleanup.
export function shutTaskSimulators(
  s: Pick<Session, "id" | "host_id"> &
    Partial<Pick<Session, "branch_name" | "worktree_path">>
): void {
  try {
    if (!enabled() || isRemoteHost(s.host_id)) return;
    // Before the caller removes the worktree, which realpath needs.
    const names = new Set(
      taskDeviceNames(
        { id: s.id, branch_name: s.branch_name ?? null },
        pathVariants(s.worktree_path ?? null)
      )
    );
    void listDevices()
      .then((devices) =>
        shutAll(
          devices.filter((d) => running(d) && names.has(d.name)),
          "its task ended"
        )
      )
      .catch((error) => console.error("[simulator] list:", error));
  } catch (error) {
    console.error("[simulator] shutTaskSimulators:", error);
  }
}

let sweeping = false;

// Shuts down booted simulators whose task is merged, dropped or done.
export async function shutFinishedTaskSimulators(): Promise<number> {
  if (!enabled() || sweeping) return 0;
  sweeping = true;
  try {
    const devices = (await listDevices()).filter(
      (d) =>
        (running(d) && d.name.startsWith("agentos-")) ||
        (running(d) && d.name.startsWith("aos-"))
    );
    if (devices.length === 0) return 0;
    const tasks = (
      db
        .prepare(
          `SELECT id, branch_name, worktree_path, task_status, host_id
           FROM sessions WHERE task_status IS NOT NULL`
        )
        .all() as (TaskRef & { host_id: string })[]
    ).filter((t) => !isRemoteHost(t.host_id));
    const stale = planFinishedShutdowns(devices, tasks);
    return await shutAll(stale, "its task is finished");
  } finally {
    sweeping = false;
  }
}
