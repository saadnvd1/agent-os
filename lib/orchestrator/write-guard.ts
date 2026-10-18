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

import { agentosHome } from "../agentos-home";
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { db, type Session } from "../db";
import { git, GitError } from "../git-exec";
import { isOrchestratorSecretPath as isSecretPath } from "../secret-paths";
import { WORKTREES_DIR } from "../worktrees";
import { orchestratorDir } from "./home";
import { LIMITS_FILE } from "./usage";
import { quickWorktrees } from "./quick-store";
import { shellRefusal } from "./shell-guard";
import { liveCheckout } from "../dev-instance/liveServer";

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
  // Its own Claude Code auto-memory folder (~/.claude/projects/<mangled
  // cwd>/memory), as named, and the one `audits` folder in `state`: the only
  // two places in a protected area it may write.
  memory?: string[];
  audits?: string;
}

// Wherever they are, files that configure what an agent, git or a
// language runtime runs.
const RUNS_CODE =
  /(^|\/)(\.git|\.claude|\.codex|\.cursor|\.vscode|\.husky|\.githooks)(\/|$)|(^|\/)(\.mcp\.json|\.claude\.json|CLAUDE(\.local)?\.md|AGENTS\.md|\.envrc|\.gitconfig|\.gitattributes|\.gitmodules|sitecustomize\.py|usercustomize\.py)$|\.pth$/i;

// The temporary checkouts AgentOS reviews, rebases and writes PR bodies in
// (repo.ts, rebase.ts): an edit while a review runs would change what it
// judges.
const AGENTOS_TEMP = /(^|\/)aos-(review|rebase|body)-[^/]+(\/|$)/;

// A git repository's layout. Git config can run programs (core.fsmonitor,
// diff.external, filter and textconv drivers), so even in its own quick
// worktrees an orchestrator never writes these.
const GIT_LAYOUT_FILE = /(^|\/)(HEAD|\.gitattributes)$|(^|\/)\.git(\/|$)/i;

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

// How Claude Code names a project's folder under ~/.claude/projects.
export const mangleCwd = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

// A folder that must sit exactly where its name says under `parent` (no
// link in it or between leading elsewhere). Returns the roots a write may go
// under, or none.
async function plainRoot(dir: string, parent: string): Promise<string[]> {
  const byName = path.join(
    await physicalPath(parent),
    path.relative(parent, dir)
  );
  const real = await physicalPath(dir);
  return key(real) === key(byName) ? [byName, path.resolve(dir)] : [];
}

const expandHome = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());

// Why a write to this path is refused, or null when it may go ahead. For a
// shell command (`shell`), only the deny list's places count: a project
// repository or task worktree that isn't its own quick change, a review's
// checkout, and AgentOS's state outside its folder.
export async function writeRefusal(
  filePath: string,
  bounds: WriteBounds,
  { shell = false }: { shell?: boolean } = {}
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
  let memory: string[];
  let audits: string[];
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
    memory = (
      await Promise.all(
        (bounds.memory ?? []).map((m) =>
          plainRoot(m, path.join(bounds.home, ".claude", "projects"))
        )
      )
    ).flat();
    audits = bounds.audits ? await plainRoot(bounds.audits, bounds.state) : [];
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
    const inAudits = audits.find((d) => within(target, d));
    const holdsAudits = (r: string) =>
      !!inAudits && within(inAudits, r) && !within(r, inAudits);
    const repo = repos.find(
      (r) => within(target, r) && !holdsQuick(r) && !holdsAudits(r)
    );
    if (repo)
      return `${key(filePath) === key(repo) ? repo : `${filePath} is inside ${repo}`} is a project repository, task worktree or AgentOS itself. Change code there through a task (start_task), or for a small edit, in a quick change's worktree (quick_change), so its PR goes through the merge gates.`;
    if (ownQuick && !shell && GIT_LAYOUT_FILE.test(target))
      return `${filePath} is part of a git repository's layout (HEAD, .git/, .gitattributes); git config can run programs, so orchestrators never write those.`;
    if (AGENTOS_TEMP.test(target))
      return `${filePath} is in a checkout AgentOS is reviewing or rebasing; orchestrators never write there.`;
    // Its folder, or a quick worktree (which sits in ~/.agent-os/worktrees):
    // AgentOS's state and the home's dot-folders hold it, but it's its own.
    const own =
      ownDir.some((d) => within(target, d)) || !!ownQuick || !!inAudits;
    if (state.some((d) => within(target, d)) && !own)
      return `${filePath} is in AgentOS's own state (${bounds.state}); you may write only in your folder, ${bounds.ownDir}.`;
    if (shell) continue;
    if (isSecretPath(target) || isSecretPath(filePath))
      return `${filePath} holds or guards secrets; orchestrators never write those.`;
    const runsIn = runs.find((r) => within(target, r));
    // In its memory folder or audits, the rest of the path is what counts:
    // the `.claude` and `.agent-os` above it are why it's allowed.
    const inMemory = memory.find((d) => within(target, d));
    const sub = inMemory ?? inAudits;
    const rest = sub ? target.slice(sub.length) : null;
    if (
      (rest === null
        ? RUNS_CODE.test(target) || RUNS_CODE.test(filePath)
        : RUNS_CODE.test(rest)) ||
      runsIn ||
      (!own &&
        !inMemory &&
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

const agentOsDbPath = () =>
  path.resolve(process.env.DB_PATH || path.join(process.cwd(), "agent-os.db"));

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
  const dbPath = agentOsDbPath();
  const repos = projects.map((p) => expandHome(p.dir)).filter((d) => d !== "");
  const cwd = expandHome(session.working_directory);
  return {
    cwd,
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
    memory: [...new Set([cwd, await physicalPath(cwd)])].map((c) =>
      path.join(os.homedir(), ".claude", "projects", mangleCwd(c), "memory")
    ),
    audits: agentosHome("audits"),
    quick: quickWorktrees(session.id),
    state: agentosHome(),
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

// A shell command, against the deny list (shell-guard.ts), its writes held
// to the shell's share of the write bounds.
async function commandRefusal(
  session: Session,
  command: unknown
): Promise<string | null> {
  const bounds = await orchestratorWriteBounds(session);
  const dbFile = agentOsDbPath();
  return shellRefusal(command, {
    cwd: bounds.cwd,
    writeRefusal: (p) => writeRefusal(p, bounds, { shell: true }),
    isAgentOsState: async (p) => {
      const real = await physicalPath(p);
      const dbReal = await physicalPath(dbFile);
      if ([p, real].some((f) => f === dbFile || f === dbReal)) return true;
      const own = await physicalPath(bounds.ownDir);
      const state = await physicalPath(bounds.state);
      return within(real, state) && !within(real, own);
    },
    inAudits: async (p) => {
      const roots = bounds.audits
        ? await plainRoot(bounds.audits, bounds.state)
        : [];
      return roots.some((r) => within(p, r));
    },
    checkoutKind: (dir) => checkoutKind(session, dir),
    protectedPids,
  });
}

// Whether a folder is a project checkout of the session's own workspace
// (where it may update and move the branch), a checkout AgentOS's live
// server or autodeploy runs from (never), or neither. The live ones are the
// server's folder, the one live-server.json recorded (known even while the
// server restarts), and any main checkout holding scripts/autodeploy, since
// that script deploys the folder it sits in (a task worktree has a .git
// file, not a folder).
export async function checkoutKind(
  session: Session,
  dir: string
): Promise<"own" | "live" | "other"> {
  const real = await physicalPath(dir);
  const roots = async (paths: (string | undefined)[]) =>
    Promise.all(
      paths
        .filter((p): p is string => !!p)
        .flatMap((p) => [path.resolve(p), p])
        .map((p) => physicalPath(p))
    );
  const live = await roots([process.cwd(), liveCheckout() ?? undefined]);
  if (live.some((r) => within(real, r)) || deploysFrom(real)) return "live";
  if (!session.workspace_id) return "other";
  const own = db
    .prepare(
      `SELECT working_directory AS dir FROM projects
        WHERE workspace_id = ? AND is_uncategorized = 0 AND host_id = 'local'
       UNION SELECT r.path FROM project_repositories r
         JOIN projects p ON p.id = r.project_id
        WHERE p.workspace_id = ? AND p.host_id = 'local'`
    )
    .all(session.workspace_id, session.workspace_id) as { dir: string }[];
  const mine = await roots(own.map((p) => expandHome(p.dir)).filter(Boolean));
  return mine.some((r) => within(real, r)) ? "own" : "other";
}

function deploysFrom(real: string): boolean {
  for (let at = real; ; at = path.dirname(at)) {
    try {
      if (
        fs.statSync(path.join(at, "scripts", "autodeploy")).isFile() &&
        fs.statSync(path.join(at, ".git")).isDirectory()
      )
        return true;
    } catch {
      // Not here; look higher.
    }
    if (path.dirname(at) === at) return false;
  }
}

// AgentOS's server (whatever listens on its port), the tmux servers its
// sessions run in, and this worker. A lookup that fails refuses the kill.
async function protectedPids(): Promise<Set<number>> {
  const port = process.env.AGENTOS_PORT || process.env.PORT || "3011";
  const pids = (cmd: string, args: string[]) =>
    new Promise<number[]>((resolve, reject) =>
      execFile(cmd, args, { timeout: 5000 }, (e, out) => {
        // Exit 1 is "nothing matched".
        if (e && (e as { code?: unknown }).code !== 1)
          return reject(new Error(`couldn't list processes with ${cmd}`));
        resolve(out.split(/\s+/).filter(Boolean).map(Number));
      })
    );
  const [server, tmux] = await Promise.all([
    pids("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]),
    pids("pgrep", ["-x", "tmux"]),
  ]);
  return new Set([...server, ...tmux, process.pid, process.ppid]);
}
