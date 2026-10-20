// Before a task starts: who else is working on the same thing. The files it
// will touch are guessed from the prompt (paths that exist in the repo).
// Any failure means no overlaps: this never blocks a start.

import { git } from "../git-exec";
import { repoKey } from "../git-remote";
import { getProject } from "../projects";
import { untrusted } from "../orchestrator/untrusted";
import { expandHome } from "../tasks/session";
import { claimsShared, machineId, machineName } from "./machine";
import { overlapBetween } from "./overlap";
import { liveClaims } from "./store";
import { MAX_FILES, type Claim, type Overlap } from "./types";

export interface StartCheck {
  // Overlaps of the new start (as `a`) with live claims (as `b`), strong first.
  overlaps: Overlap[];
}

const PATH_LIKE = /[\w@.+-]+(?:\/[\w@.+-]+)*\.[A-Za-z0-9]{1,8}\b/g;

async function predictedFiles(dir: string, prompt: string): Promise<string[]> {
  const tokens = [...new Set(prompt.match(PATH_LIKE) ?? [])].slice(0, 100);
  if (!tokens.length) return [];
  const tracked = new Set(
    (await git(dir, ["ls-files", "-z"], { timeout: 5000 }))
      .split("\0")
      .filter(Boolean)
  );
  return tokens.filter((t) => tracked.has(t)).slice(0, MAX_FILES);
}

export async function checkStart(opts: {
  projectId: string;
  name?: string;
  prompt: string;
  branch?: string | null;
  now?: number;
}): Promise<StartCheck> {
  const none: StartCheck = { overlaps: [] };
  try {
    if (!claimsShared()) return none;
    const project = getProject(opts.projectId);
    if (!project) return none;
    const dir = expandHome(project.working_directory);
    const repo = await repoKey(dir);
    if (!repo) return none;
    const live = liveClaims({ repo, now: opts.now });
    if (!live.length) return none;
    const now = opts.now ?? Date.now();
    const goal = (opts.name?.trim() || opts.prompt.split("\n")[0]).slice(
      0,
      120
    );
    const mine: Claim = {
      id: "start",
      origin: machineId(),
      originName: machineName(),
      viaMachine: null,
      hops: 0,
      source: "session",
      sessionId: null,
      sessionName: null,
      repo,
      branch: opts.branch ?? null,
      base: null,
      goal,
      files: await predictedFiles(dir, opts.prompt).catch(() => []),
      filesMore: 0,
      prUrl: null,
      startedAt: now,
      expiresAt: now,
      released: null,
      updatedAt: now,
    };
    const overlaps = live
      .map((c) => overlapBetween(mine, c))
      .filter((o): o is Overlap => !!o)
      .sort(
        (x, y) =>
          Number(y.strength === "strong") - Number(x.strength === "strong")
      );
    return { overlaps };
  } catch (error) {
    console.error("[claims] start check:", error);
    return none;
  }
}

const where = (c: Claim) =>
  c.origin === machineId() ? "here" : `on ${c.originName}`;

// "'<goal>' on box (branch x) touches a.ts, b.ts", fenced: another machine's words.
export function overlapText(o: Overlap): string {
  const shared = o.shared.length
    ? ` touches ${o.shared.slice(0, 5).join(", ")}`
    : "";
  const branch = o.b.branch ? ` (branch ${o.b.branch})` : "";
  return `${untrusted("claim", o.b.goal)} ${where(o.b)}${branch}${shared}`;
}
