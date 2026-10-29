/**
 * Where a task may run. A task's needs are a small set (a Mac, Xcode, a
 * simulator); a machine reports what it has. Needs come from, in order: the
 * task's own setting, a `machine:` line in its brief, the project's
 * agentos.json, and what the repository's files imply. `place` is pure: the
 * machines' readings in, the machine to start it on out. iOS work never
 * leaves a Mac, because no other machine reports those capabilities.
 */

import fs from "fs";
import path from "path";
import { db } from "../db";
import { loadProjectConfig } from "../project-config";
import { MACHINE_NEEDS } from "../project-config/schema";
import { machineHold, placeable, type MachineView } from "./holds";
import type { Candidate } from "./schedule";

export type Need = (typeof MACHINE_NEEDS)[number];
export type NeedsSource = "task" | "brief" | "config" | "inferred" | "none";

const ALL_MAC: Need[] = ["mac", "xcode", "simulator"];

const isNeed = (v: unknown): v is Need =>
  typeof v === "string" && (MACHINE_NEEDS as readonly string[]).includes(v);

export const heavyNeeds = (needs: Need[]) => needs.includes("simulator");

export const meetsNeeds = (needs: Need[], capabilities: string[]) =>
  needs.every((n) => capabilities.includes(n));

// What a request's `machine` setting means: "mac" pins it to a Mac, "any"
// says it needs nothing.
export function needsFromSetting(setting: unknown): Need[] | null {
  if (setting === "any") return [];
  if (setting === "mac") return ["mac"];
  if (Array.isArray(setting)) return setting.filter(isNeed);
  return null;
}

// `machine: mac` or `needs: simulator, xcode` on a line of its own.
export function needsFromBrief(prompt: string): Need[] | null {
  const m = /^[ \t]*(?:machine|needs)[ \t]*:[ \t]*([^\n]+)$/im.exec(prompt);
  if (!m) return null;
  const words = m[1]
    .toLowerCase()
    .split(/[,\s]+/)
    .filter(Boolean);
  if (words.includes("any")) return [];
  const out = new Set<Need>();
  for (const w of words) {
    if (isNeed(w)) out.add(w);
    if (w === "ios") ALL_MAC.forEach((n) => out.add(n));
  }
  return out.size ? [...out] : null;
}

// An Xcode project or workspace one level down (ios/App.xcodeproj), or an
// Expo app with an ios section.
export function inferNeeds(projectPath: string): Need[] {
  const ios = path.join(projectPath, "ios");
  try {
    if (
      fs
        .readdirSync(ios)
        .some((f) => f.endsWith(".xcodeproj") || f.endsWith(".xcworkspace"))
    )
      return ALL_MAC;
  } catch {
    // no ios folder
  }
  try {
    const app = JSON.parse(
      fs.readFileSync(path.join(projectPath, "app.json"), "utf-8")
    ) as { ios?: unknown; expo?: { ios?: unknown } };
    if (app.ios || app.expo?.ios) return ALL_MAC;
  } catch {
    // no app.json
  }
  return [];
}

// Whether the starter asked for a Mac outright: the request's `machine`
// (stored on the queue row, which shares the task's id), a recipe's, or the
// project's own machine setting. A need read from the brief or the files
// doesn't count: that one a plan can ignore.
export function pinnedToMac(
  stored: string | null,
  projectPath: string
): boolean {
  const asked = parseNeeds(stored);
  if (asked) return asked.includes("mac");
  return !!loadProjectConfig(projectPath).config.machine?.needs?.includes(
    "mac"
  );
}

export function taskPinnedToMac(taskId: string, projectPath: string): boolean {
  const row = db
    .prepare(`SELECT machine_needs FROM task_queue WHERE id = ?`)
    .get(taskId) as { machine_needs: string | null } | undefined;
  return pinnedToMac(row?.machine_needs ?? null, projectPath);
}

export function needsOf(input: {
  projectId: string;
  projectPath: string;
  prompt: string;
  setting?: unknown;
}): { needs: Need[]; source: NeedsSource } {
  const task = needsFromSetting(input.setting);
  if (task) return { needs: task, source: "task" };
  const brief = needsFromBrief(input.prompt);
  if (brief) return { needs: brief, source: "brief" };
  const loaded = loadProjectConfig(input.projectPath);
  const declared = loaded.config.machine?.needs;
  if (declared) return { needs: declared, source: "config" };
  if (loaded.config.simulator) return remember(input.projectId, ALL_MAC);
  const inferred = inferNeeds(input.projectPath);
  return remember(input.projectId, inferred);
}

// Kept on the project so a list can show it without reading its files.
function remember(
  projectId: string,
  needs: Need[]
): { needs: Need[]; source: NeedsSource } {
  const json = JSON.stringify(needs);
  try {
    db.prepare(
      `UPDATE projects SET machine_needs = ?, machine_needs_source = 'inferred'
       WHERE id = ? AND (machine_needs IS NOT ?)`
    ).run(json, projectId, json);
  } catch {
    // a read-only caller: the answer stands without the note
  }
  return { needs, source: needs.length ? "inferred" : "none" };
}

export const parseNeeds = (json: string | null): Need[] | null => {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter(isNeed) : null;
  } catch {
    return null;
  }
};

// Why a queued task can't be started on another machine, or null. These are
// the kinds of task `startRemoteTask` refuses or would change on the way.
export function unplaceable(r: {
  plan_only: number | null;
  plan: number | null;
  agent_type: string | null;
  model_overrides: string | null;
  host_id: string | null;
}): string | null {
  if (r.host_id) return "it was pinned to a machine";
  if (r.agent_type && r.agent_type !== "claude")
    return "only Claude tasks run on another machine";
  if (r.model_overrides) return "per-role models run on this machine";
  return null;
}

export interface PeerOption {
  hostId: string;
  name: string;
  view: MachineView;
  capabilities: string[];
  // It can hold an orchestrator's task (false: an older AgentOS). Unset: yes.
  holds?: boolean;
  // It can run a plan step that stops for this machine (false: an older
  // AgentOS). Unset: yes.
  plans?: boolean;
  // The project exists there (projectMachines said null).
  hasProject: boolean;
  loadPerCore: number;
}

// A start that plans first: the plan phase only reads code, so it needs no
// simulator or Mac, and the plan-only skip of load holds doesn't apply to
// where it goes, only to whether it may wait. The candidate as a plan phase
// sees it.
export const asPlanPhase = <
  T extends Pick<Candidate, "heavy" | "needsUnmet" | "planOnly">,
>(
  c: T
): T => ({ ...c, heavy: false, needsUnmet: false, planOnly: false });

export interface Placement {
  hostId: string;
  name: string;
  // Shown in the row and told to the orchestrator: "this machine load red".
  why: string;
}

// True when the home machine's load or needs rule this start out, which is
// the only time a linked machine is worth asking.
export const wantsPlacing = (
  c: Pick<Candidate, "heavy" | "needsUnmet" | "remote" | "priority">,
  home: MachineView,
  now: number
): boolean => {
  if (c.remote || home.reading) return false;
  const hold = machineHold(c, home, now);
  return !!hold && placeable(hold);
};

// Null: start it at home (or hold it there for a reason placing doesn't
// change). Otherwise the best linked machine that is green, fresh, has the
// project and meets the needs.
export function place(
  c: Pick<Candidate, "heavy" | "needsUnmet" | "remote" | "priority">,
  home: MachineView,
  peers: PeerOption[],
  needs: Need[],
  now: number
): Placement | null {
  if (!wantsPlacing(c, home, now)) return null;
  const hold = machineHold(c, home, now)!;
  const options = peers
    .filter(
      (p) =>
        p.hasProject &&
        meetsNeeds(needs, p.capabilities) &&
        machineHold({ ...c, needsUnmet: false, heavy: false }, p.view, now) ===
          null
    )
    .sort(
      (a, b) =>
        a.loadPerCore - b.loadPerCore || a.hostId.localeCompare(b.hostId)
    );
  const best = options[0];
  if (!best) return null;
  return {
    hostId: best.hostId,
    name: best.name,
    why:
      hold.code === "needs"
        ? "needs not met here"
        : `${home.label} load ${home.level}`,
  };
}
