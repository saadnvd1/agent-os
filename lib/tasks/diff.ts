/**
 * A task's whole change, base branch to head (merge-base), for the phone to
 * review: a file list with status and line counts, then one file's patch.
 * Read from the task's worktree when it's there, else from its PR on GitHub.
 * Sizes are capped and say so; a file is only ever one the change lists.
 */

import { git, isGitError, resolveRef } from "../git-exec";
import { getDefaultBranch, isGitRepo, isBranchName } from "../git";
import { existingRef } from "../orchestrator/repo";
import { run } from "./gh";
import { repoOfPR } from "./pr-activity";
import { localWorktree, projectPathFor } from "./session";
import { LoopError } from "./loop-error";
import {
  DIFF_MAX_FILES,
  DIFF_PATCH_MAX_BYTES,
  type TaskDiffFile,
  type TaskDiffList,
  type TaskDiffPatch,
} from "./loop-types";
import type { Session } from "../db";

export interface DiffCaps {
  files: number;
  patchBytes: number;
}
const CAPS: DiffCaps = {
  files: DIFF_MAX_FILES,
  patchBytes: DIFF_PATCH_MAX_BYTES,
};

const MAX_PATH_BYTES = 1024;

/** A path the change could list: relative, inside the repo, no tricks. */
export function validDiffPath(file: unknown): file is string {
  if (typeof file !== "string" || !file) return false;
  if (Buffer.byteLength(file) > MAX_PATH_BYTES) return false;
  if (file.includes("\0") || file.includes("\\")) return false;
  if (file.startsWith("/") || file.startsWith("-")) return false;
  return !file.split("/").some((part) => part === ".." || part === "");
}

const STATUS_OF_GITHUB: Record<string, string> = {
  added: "A",
  removed: "D",
  modified: "M",
  changed: "M",
  renamed: "R",
  copied: "C",
};

interface Source {
  kind: "worktree" | "pr";
  base: string;
  head: string;
  list: () => Promise<TaskDiffFile[]>;
  patch: (file: string) => Promise<{ patch: string | null; tooLarge: boolean }>;
}

// `git diff --numstat -z` and `--name-status -z`, joined by path.
function parseGit(numstat: string, nameStatus: string): TaskDiffFile[] {
  const status = new Map<string, string>();
  const parts = nameStatus.split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2)
    status.set(parts[i + 1], parts[i][0] || "M");
  const files: TaskDiffFile[] = [];
  for (const row of numstat.split("\0")) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(row);
    if (!m) continue;
    const binary = m[1] === "-";
    files.push({
      path: m[3],
      status: status.get(m[3]) ?? "M",
      additions: binary ? null : Number(m[1]),
      deletions: binary ? null : Number(m[2]),
      binary,
    });
  }
  return files;
}

async function worktreeSource(
  session: Session,
  dir: string,
  caps: DiffCaps
): Promise<Source> {
  if (!(await isGitRepo(dir))) throw new LoopError("No repository", 404);
  const recorded = session.base_branch || (await getDefaultBranch(dir));
  if (!isBranchName(recorded)) throw new LoopError("Unknown base branch", 404);
  const base = await existingRef(dir, recorded);
  if (!base) throw new LoopError("The base branch isn't here", 404);
  const head = (await resolveRef(dir, "HEAD")) ?? "";
  const range = `${base}...HEAD`;
  const flags = ["--no-renames", "--no-ext-diff", "--no-textconv"];
  return {
    kind: "worktree",
    base: recorded,
    head,
    list: async () => {
      const [numstat, names] = await Promise.all([
        git(dir, ["diff", "--numstat", "-z", ...flags, range, "--"]),
        git(dir, ["diff", "--name-status", "-z", ...flags, range, "--"]),
      ]);
      return parseGit(numstat, names);
    },
    patch: async (file) => {
      try {
        const out = await git(
          dir,
          ["diff", "--no-color", ...flags, range, "--", file],
          { literalPathspecs: true, maxBuffer: caps.patchBytes * 4 }
        );
        return { patch: out, tooLarge: false };
      } catch (error) {
        if (
          isGitError(error) &&
          error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        )
          return { patch: null, tooLarge: true };
        throw error;
      }
    },
  };
}

interface GithubFile {
  filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

async function prSource(session: Session): Promise<Source> {
  const repo = session.pr_url ? repoOfPR(session.pr_url) : null;
  const dir = projectPathFor(session);
  if (!repo || !session.pr_number || !dir)
    throw new LoopError("The task has no worktree and no pull request", 404);
  const slug = `${repo.owner}/${repo.name}`;
  const meta = JSON.parse(
    await run(
      "gh",
      [
        "pr",
        "view",
        String(session.pr_number),
        "--repo",
        slug,
        "--json",
        "baseRefName,headRefOid",
      ],
      dir,
      15000
    )
  ) as { baseRefName?: string; headRefOid?: string };
  const pages = async (): Promise<GithubFile[]> => {
    const all: GithubFile[] = [];
    for (let page = 1; page <= 3; page++) {
      const rows = JSON.parse(
        await run(
          "gh",
          [
            "api",
            `repos/${slug}/pulls/${session.pr_number}/files?per_page=100&page=${page}`,
          ],
          dir,
          30000
        )
      ) as GithubFile[];
      all.push(...rows);
      if (rows.length < 100) break;
    }
    return all;
  };
  let cached: GithubFile[] | null = null;
  const rows = async () => (cached ??= await pages());
  return {
    kind: "pr",
    base: meta.baseRefName ?? "",
    head: meta.headRefOid ?? "",
    list: async () =>
      (await rows())
        .filter((f) => typeof f.filename === "string")
        .map((f) => ({
          path: f.filename!,
          status: STATUS_OF_GITHUB[f.status ?? ""] ?? "M",
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
          binary: false,
        })),
    patch: async (file) => {
      const hit = (await rows()).find((f) => f.filename === file);
      return typeof hit?.patch === "string"
        ? { patch: hit.patch, tooLarge: false }
        : { patch: null, tooLarge: true };
    },
  };
}

async function sourceFor(session: Session, caps: DiffCaps): Promise<Source> {
  const dir = localWorktree(session);
  if (dir) return worktreeSource(session, dir, caps);
  return prSource(session);
}

// Cut at a line break at or before `max` bytes.
export function capPatch(
  patch: string,
  max: number
): { patch: string; truncated: boolean } {
  if (Buffer.byteLength(patch) <= max) return { patch, truncated: false };
  const cut = Buffer.from(patch).subarray(0, max).toString("utf8");
  const nl = cut.lastIndexOf("\n");
  return { patch: nl > 0 ? cut.slice(0, nl) : cut, truncated: true };
}

/** The file list, or with `file` that one file's patch. */
export async function taskDiff(
  session: Session,
  file?: string | null,
  caps: DiffCaps = CAPS
): Promise<TaskDiffList | TaskDiffPatch> {
  if (file != null && !validDiffPath(file))
    throw new LoopError("Not a path in the change", 400);
  const source = await sourceFor(session, caps);
  const all = await source.list();
  if (file != null) {
    if (!all.some((f) => f.path === file))
      throw new LoopError("That file isn't in the change", 404);
    const { patch, tooLarge } = await source.patch(file);
    if (patch === null)
      return {
        source: source.kind,
        path: file,
        patch: null,
        truncated: true,
        tooLarge: true,
      };
    const capped = capPatch(patch, caps.patchBytes);
    return {
      source: source.kind,
      path: file,
      patch: capped.patch,
      truncated: capped.truncated,
      tooLarge,
    };
  }
  return {
    source: source.kind,
    base: source.base,
    head: source.head,
    files: all.slice(0, caps.files),
    totalFiles: all.length,
    additions: all.reduce((n, f) => n + (f.additions ?? 0), 0),
    deletions: all.reduce((n, f) => n + (f.deletions ?? 0), 0),
    truncated: all.length > caps.files,
  };
}
