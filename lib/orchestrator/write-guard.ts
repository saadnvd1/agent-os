/**
 * Where an orchestrator may write. Anywhere on the machine except the
 * workspace's project repositories and their task worktrees (code changes go
 * through tasks, so the merge gates keep meaning something), AgentOS's own
 * install and state (all of ~/.agent-os but its own folder), secret files,
 * and files that make something run: the dotfiles and dot-folders in its
 * home (shell, git, Claude and tool config), ~/Library, the folders on PATH,
 * and any .git, .claude, .mcp.json, CLAUDE.md or the like. A write to one of
 * those would hand it a shell, or run code in AgentOS's own git, without
 * touching a protected path itself. Its chat worker checks every Write, Edit and NotebookEdit here
 * before it runs (a PreToolUse hook), on the path with every symlink and
 * `..` resolved the way the system will resolve it.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { db, type Session } from "../db";
import { git, GitError } from "../git-exec";
import { isSecretPath } from "../secret-paths";
import { WORKTREES_DIR } from "../worktrees";
import { orchestratorDir } from "./home";
import { LIMITS_FILE } from "./usage";
import { readCommand } from "./git-guard";
import { quickWorktrees } from "./quick-store";

// The tools that write a file, and the argument naming it.
export const WRITE_TOOLS: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

export interface WriteBounds {
  // Relative paths are taken from here.
  cwd: string;
  // Its own folder, the one part of `state` it may write.
  ownDir: string;
  // AgentOS's state (~/.agent-os).
  state: string;
  // Project repositories, task worktrees and AgentOS's install.
  repos: string[];
  // Its home: no dotfile or dot-folder in it may be written.
  home: string;
  // Folders whose files run (~/Library, PATH, the usage brake's input...).
  runs: string[];
  // Its own quick changes' worktrees (quick.ts): the one place in a
  // project it may write, everything else in `repos` still refused.
  quick?: string[];
}

// Wherever they are, files that configure what an agent, git or a
// language runtime runs.
const RUNS_CODE =
  /(^|\/)(\.git|\.claude|\.codex|\.cursor|\.vscode|\.husky|\.githooks)(\/|$)|(^|\/)(\.mcp\.json|\.claude\.json|CLAUDE(\.local)?\.md|AGENTS\.md|\.envrc|\.gitconfig|\.gitattributes|\.gitmodules|sitecustomize\.py|usercustomize\.py)$|\.pth$/i;

// The temporary checkouts AgentOS reviews, rebases and writes PR bodies in
// (repo.ts, rebase.ts): an edit while a review runs would change what it
// judges.
const AGENTOS_TEMP = /(^|\/)aos-(review|rebase|body)-[^/]+(\/|$)/;

const MAX_LINKS = 40;

// The path as the system resolves it: component by component from the root,
// each symlink followed where it sits (a dangling one too, since a write
// creates its target), and `..` taken from the real folder it's in. Parts
// that don't exist yet are kept as named, under the real folder they'd be
// made in.
export async function physicalPath(p: string): Promise<string> {
  const parts = p.split("/").filter(Boolean);
  let at = "/";
  let links = 0;
  while (parts.length) {
    const part = parts.shift()!;
    if (part === ".") continue;
    if (part === "..") {
      at = path.dirname(at);
      continue;
    }
    const next = path.join(at, part);
    const link = await fs.promises.readlink(next).catch(() => null);
    if (link === null) {
      at = next;
      continue;
    }
    if (++links > MAX_LINKS) throw new Error("Too many symlinks");
    parts.unshift(...link.split("/").filter(Boolean));
    if (link.startsWith("/")) at = "/";
  }
  return canonical(at);
}

// Its deepest existing folder as the file system spells it, so a path in
// another case or Unicode form (one folder on macOS) compares equal.
async function canonical(p: string): Promise<string> {
  const rest: string[] = [];
  let at = p;
  for (;;) {
    try {
      return path.join(await fs.promises.realpath(at), ...rest.reverse());
    } catch {
      const up = path.dirname(at);
      if (up === at) return p;
      rest.push(path.basename(at));
      at = up;
    }
  }
}

const FOLDS_CASE =
  process.platform === "darwin" || process.platform === "win32";
const key = (p: string) =>
  FOLDS_CASE ? p.normalize("NFC").toLowerCase() : p.normalize("NFC");

const within = (p: string, root: string) => {
  const [a, b] = [key(p), key(root)];
  return a === b || a.startsWith(b === "/" ? b : b + "/");
};

const expandHome = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());

// Why a write to this path is refused, or null when it may go ahead.
export async function writeRefusal(
  filePath: string,
  bounds: WriteBounds
): Promise<string | null> {
  if (!filePath) return "No file path to check.";
  const given = expandHome(filePath);
  const abs = given.startsWith("/") ? given : `${bounds.cwd}/${given}`;
  let targets: string[];
  let repos: string[];
  let state: string[];
  let ownDir: string[];
  let home: string[];
  let runs: string[];
  let quick: string[][];
  try {
    // Where it lands as written, and with `..` taken by name first, as a
    // tool that normalises the path before opening it would; and where it
    // was asked for, before any link: all must be allowed. A link sitting in
    // a protected place (a dotfile kept in a dotfiles repo, Homebrew's
    // bin/git) is refused there, wherever it points.
    targets = [
      ...new Set([
        ...(await Promise.all([
          physicalPath(abs),
          physicalPath(path.resolve(abs)),
        ])),
        path.resolve(abs),
      ]),
    ];
    // Each folder by its own name too, for a path that reaches it by name.
    const both = async (p: string) => [path.resolve(p), await physicalPath(p)];
    repos = (await Promise.all(bounds.repos.map(both))).flat();
    runs = (await Promise.all(bounds.runs.map(both))).flat();
    state = await both(bounds.state);
    ownDir = await both(bounds.ownDir);
    home = await both(bounds.home);
    quick = await Promise.all((bounds.quick ?? []).map(both));
  } catch (e) {
    return `Couldn't resolve ${filePath}: ${(e as Error).message}.`;
  }
  for (const target of targets) {
    // Inside one of its quick worktrees, the roots that hold that worktree
    // (the worktrees folder, a project above it) don't count; any other
    // root, one nested inside it included, still refuses.
    const ownQuick = quick.find((q) => q.some((d) => within(target, d)));
    const holdsQuick = (r: string) =>
      !!ownQuick && ownQuick.some((d) => within(d, r));
    const repo = repos.find((r) => within(target, r) && !holdsQuick(r));
    if (repo)
      return `${filePath} is inside ${repo}, a project repository, task worktree or AgentOS itself. Change code there through a task (start_task), or for a small edit, in a quick change's worktree (quick_change), so its PR goes through the merge gates.`;
    if (AGENTOS_TEMP.test(target))
      return `${filePath} is in a checkout AgentOS is reviewing or rebasing; orchestrators never write there.`;
    // Its folder, or a quick worktree (which sits in ~/.agent-os/worktrees):
    // AgentOS's state and the home's dot-folders hold it, but it's its own.
    const own = ownDir.some((d) => within(target, d)) || !!ownQuick;
    if (state.some((d) => within(target, d)) && !own)
      return `${filePath} is in AgentOS's own state (${bounds.state}); you may write only in your folder, ${bounds.ownDir}.`;
    if (isSecretPath(target) || isSecretPath(filePath))
      return `${filePath} holds or guards secrets; orchestrators never write those.`;
    const runsIn = runs.find((r) => within(target, r));
    if (
      RUNS_CODE.test(target) ||
      RUNS_CODE.test(filePath) ||
      runsIn ||
      (!own &&
        home.some(
          (h) =>
            within(target, h) &&
            key(target)
              .slice(key(h).length + 1)
              .startsWith(".")
        ))
    )
      return `${filePath} configures what runs (shell, git, agent or tool config${runsIn ? `, in ${runsIn}` : ""}); orchestrators never write those.`;
  }
  return null;
}

// What an orchestrator's writes are held to, read fresh for each one so a
// project added since counts: every local project's repositories (not just
// its workspace's, since a write to another workspace's repo skips its gates
// as much), every session's worktree, and AgentOS's install and database.
export async function orchestratorWriteBounds(
  session: Session
): Promise<WriteBounds> {
  const projects = db
    .prepare(
      `SELECT working_directory AS dir FROM projects
        WHERE is_uncategorized = 0 AND host_id = 'local'
       UNION SELECT r.path FROM project_repositories r
         JOIN projects p ON p.id = r.project_id
        WHERE p.host_id = 'local'
       UNION SELECT worktree_path FROM sessions
        WHERE worktree_path IS NOT NULL AND worktree_path != ''`
    )
    .all() as { dir: string }[];
  const dbPath = path.resolve(
    process.env.DB_PATH || path.join(process.cwd(), "agent-os.db")
  );
  const repos = projects.map((p) => expandHome(p.dir)).filter((d) => d !== "");
  return {
    cwd: expandHome(session.working_directory),
    home: os.homedir(),
    runs: [
      path.join(os.homedir(), "Library"),
      "/Library/LaunchAgents",
      "/Library/LaunchDaemons",
      path.dirname(LIMITS_FILE),
      ...(await hooksPaths(repos)),
      ...(process.env.XDG_CONFIG_HOME ? [process.env.XDG_CONFIG_HOME] : []),
      ...(process.env.PATH ?? "").split(":").filter((d) => d.startsWith("/")),
    ],
    ownDir: orchestratorDir(session.workspace_id ?? ""),
    quick: quickWorktrees(session.id),
    state: path.join(os.homedir(), ".agent-os"),
    repos: [...repos, WORKTREES_DIR, process.cwd(), path.dirname(dbPath)],
  };
}

// Where git looks for hooks instead of .git/hooks (core.hooksPath), in the
// user's config and each project's: a script there runs on the next commit.
// Read at most once a minute, not on every write.
const HOOKS_TTL_MS = 60_000;
let hooksCache: { key: string; at: number; dirs: string[] } | null = null;

export async function hooksPaths(repos: string[]): Promise<string[]> {
  const key = repos.join("\0");
  if (hooksCache?.key === key && Date.now() - hooksCache.at < HOOKS_TTL_MS)
    return hooksCache.dirs;
  // Only "not set" and "not a repository" mean there's nothing to protect;
  // any other failure (a timeout under load) throws, so the write is
  // refused and nothing is cached.
  const run = (cwd: string, args: string[]) =>
    git(cwd, args, { timeout: 5000 })
      .then((out) => out.trim())
      .catch((e: unknown) => {
        if (
          e instanceof GitError &&
          !e.timedOut &&
          (e.exitCode === 1 || /not a git repository/i.test(e.stderr))
        )
          return "";
        throw new Error(`couldn't read git's hooks folder in ${cwd}`);
      });
  // The user's, expanded by git (~ and ~user). A relative one is taken from
  // each repo's top, so it names no one folder: each project's answer
  // below covers it there. Each project's comes as git itself resolves it.
  const global = await run(os.homedir(), [
    "config",
    "--global",
    "--type=path",
    "--get",
    "core.hooksPath",
  ]);
  const found = await Promise.all(
    repos.map(async (r) => {
      // A project whose folder is gone has no hooks to run.
      if (!fs.existsSync(r)) return "";
      const dir = await run(r, [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "hooks",
      ]);
      if (dir !== "" && !dir.startsWith("/"))
        throw new Error(`git named no folder for ${r}'s hooks`);
      return dir;
    })
  );
  const dirs = [
    ...new Set([global, ...found].filter((d) => d.startsWith("/"))),
  ];
  hooksCache = { key, at: Date.now(), dirs };
  return dirs;
}

// The check a PreToolUse hook makes: why this tool call is refused, or null.
export async function orchestratorToolRefusal(
  session: Session,
  tool: string,
  input: Record<string, unknown>
): Promise<string | null> {
  if (tool === "Bash") return commandRefusal(session, input.command);
  const arg = WRITE_TOOLS[tool];
  if (!arg) return null;
  const filePath = input[arg];
  if (typeof filePath !== "string") return "No file path to check.";
  return writeRefusal(filePath, await orchestratorWriteBounds(session));
}

// A shell command: one plain command, and git only in its own quick
// worktrees (git-guard.ts), the folder it names resolved like a write's.
async function commandRefusal(
  session: Session,
  command: unknown
): Promise<string | null> {
  const read = readCommand(command);
  if (read.refusal !== null || read.dir === null) return read.refusal;
  const quick = quickWorktrees(session.id);
  const dir = expandHome(read.dir);
  if (!dir.startsWith("/") || !quick.length)
    return `Refused: git runs only in one of your quick changes' worktrees, named by its full path (${quick.length ? quick.join(", ") : "you have none open; start one with quick_change"}).`;
  return (await insideQuick(dir, quick))
    ? null
    : `Refused: ${read.dir} isn't one of your quick changes' worktrees (${quick.join(", ")}). Project checkouts and other sessions' worktrees are never yours to run git in.`;
}

// Whether a folder is inside one of these worktrees by every way the
// system could read it: as named, with `..` taken by name, and with links
// followed.
export async function insideQuick(
  dir: string,
  quick: string[]
): Promise<boolean> {
  try {
    const forms = [
      path.resolve(dir),
      await physicalPath(dir),
      await physicalPath(path.resolve(dir)),
    ];
    const roots = (
      await Promise.all(
        quick.map(async (q) => [path.resolve(q), await physicalPath(q)])
      )
    ).flat();
    return forms.every((f) => roots.some((r) => within(f, r)));
  } catch {
    return false;
  }
}
