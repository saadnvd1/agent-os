/**
 * The one way AgentOS runs git. Every git process starts here, so they all
 * share the same hardening:
 *
 * - argv only, never a shell: a branch name, path or message is always data;
 * - off the event loop, with a ceiling (a hung ssh, a stalled mount or a
 *   stuck hook is killed at it, with SIGKILL);
 * - no prompt can ever wait for an answer (GIT_TERMINAL_PROMPT=0), and stdin
 *   is always closed;
 * - no optional locks, so a read never takes the index lock a commit or
 *   rebase needs;
 * - the server's own tmux (TMUX, TMUX_PANE) never reaches a hook;
 * - a failure is a GitError carrying the exit code, stderr and stdout.
 *
 * A lint rule (eslint.config.mjs) refuses git spawned anywhere else.
 */

import { execFile, execFileSync } from "child_process";

export const GIT_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export interface GitOptions {
  // Milliseconds before git is killed. Default GIT_TIMEOUT_MS.
  timeout?: number;
  // Written to stdin, which is closed either way.
  input?: string;
  // Added to the shared environment.
  env?: Record<string, string>;
  // Paths are names, never globs or pathspec magic: "[draft].md" or "*"
  // must not reach other files.
  literalPathspecs?: boolean;
  // Bytes of output before git is killed. Default 16MB.
  maxBuffer?: number;
  signal?: AbortSignal;
}

export class GitError extends Error {
  override readonly name = "GitError";
  constructor(
    message: string,
    readonly args: string[],
    readonly cwd: string,
    // git's exit status; null when it never exited on its own.
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stdout: string,
    readonly stderr: string,
    readonly timedOut: boolean,
    options?: { cause?: unknown }
  ) {
    super(message, options);
  }

  // What execFile's errors carry, for callers written against them.
  get code(): number | string | null {
    const cause = this.cause as { code?: unknown } | undefined;
    if (this.exitCode !== null) return this.exitCode;
    return typeof cause?.code === "string" ? cause.code : null;
  }

  get killed(): boolean {
    return this.timedOut || this.signal !== null;
  }
}

export const isGitError = (error: unknown): error is GitError =>
  error instanceof GitError;

/** The environment every git runs with. */
export function gitEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    ...extra,
  };
  delete env.TMUX;
  delete env.TMUX_PANE;
  return env;
}

const argv = (args: string[], opts: GitOptions) =>
  opts.literalPathspecs ? ["--literal-pathspecs", ...args] : args;

// The subcommand, for messages: "git worktree add", "git push".
const named = (args: string[]) => {
  const words = args.filter((a) => !a.startsWith("-")).slice(0, 2);
  return ["git", ...(words[0] === "worktree" ? words : words.slice(0, 1))]
    .join(" ")
    .trim();
};

function toGitError(
  error: unknown,
  args: string[],
  cwd: string,
  stdout: string,
  stderr: string,
  timeout: number
): GitError {
  const e = error as {
    code?: unknown;
    status?: unknown;
    killed?: boolean;
    signal?: NodeJS.Signals | null;
    name?: string;
    message?: string;
  };
  // execFile reports the exit status as `code`, execFileSync as `status`.
  const exitCode =
    typeof e.code === "number"
      ? e.code
      : typeof e.status === "number"
        ? e.status
        : null;
  const aborted = e.name === "AbortError" || e.code === "ABORT_ERR";
  const overflow = e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
  const timedOut =
    e.code === "ETIMEDOUT" ||
    (exitCode === null && !aborted && !overflow && e.killed === true);
  const what = named(args);
  const reason =
    stderr.trim() || stdout.trim() || e.message || String(error ?? "");
  const message = timedOut
    ? `${what} timed out after ${Math.round(timeout / 1000)}s`
    : `${what} failed: ${reason}`;
  return new GitError(
    message,
    args,
    cwd,
    exitCode,
    e.signal ?? null,
    stdout,
    stderr,
    timedOut,
    { cause: error }
  );
}

/** Runs git in `cwd`; resolves stdout and stderr, rejects with a GitError. */
export function gitResult(
  cwd: string,
  args: string[],
  opts: GitOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const full = argv(args, opts);
  const timeout = opts.timeout ?? GIT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      full,
      {
        cwd,
        encoding: "utf-8",
        maxBuffer: opts.maxBuffer ?? MAX_BUFFER,
        timeout,
        killSignal: "SIGKILL",
        env: gitEnv(opts.env),
        signal: opts.signal,
      },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr });
        reject(toGitError(error, args, cwd, stdout, stderr, timeout));
      }
    );
    // git exiting before it read its input is its failure, not a crash.
    child.stdin?.on("error", () => {});
    child.stdin?.end(opts.input ?? "");
  });
}

/** Runs git in `cwd` and resolves what it printed, untrimmed. */
export async function git(
  cwd: string,
  args: string[],
  opts: GitOptions = {}
): Promise<string> {
  return (await gitResult(cwd, args, opts)).stdout;
}

/** Whether git exits 0. Never throws. */
export function gitOk(
  cwd: string,
  args: string[],
  opts: GitOptions = {}
): Promise<boolean> {
  return gitResult(cwd, args, opts).then(
    () => true,
    () => false
  );
}

/**
 * The blocking form, for what runs once outside a request (the build id at
 * startup) and test setup. Never in a request handler.
 */
export function gitSync(
  cwd: string,
  args: string[],
  opts: Omit<GitOptions, "signal"> = {}
): string {
  const full = argv(args, opts);
  const timeout = opts.timeout ?? GIT_TIMEOUT_MS;
  try {
    return execFileSync("git", full, {
      cwd,
      encoding: "utf-8",
      input: opts.input ?? "",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: opts.maxBuffer ?? MAX_BUFFER,
      timeout,
      killSignal: "SIGKILL",
      env: gitEnv(opts.env),
    });
  } catch (error) {
    const e = error as { stdout?: unknown; stderr?: unknown };
    const text = (v: unknown) =>
      typeof v === "string" ? v : Buffer.isBuffer(v) ? v.toString() : "";
    throw toGitError(error, args, cwd, text(e.stdout), text(e.stderr), timeout);
  }
}

// ---------------------------------------------------------------------------
// The operations AgentOS actually runs. Names reach git as arguments after
// "--" or --end-of-options wherever git allows it, so none is read as an
// option.

const trimmed = (p: Promise<string>) => p.then((s) => s.trim());

/** `rev-parse <ref>`, trimmed. Throws when it doesn't resolve. */
export const revParse = (cwd: string, ref: string, opts?: GitOptions) =>
  trimmed(git(cwd, ["rev-parse", ref], opts));

/** The object `ref` names, or null when it names none. */
export const resolveRef = (cwd: string, ref: string, opts?: GitOptions) =>
  git(cwd, ["rev-parse", "--verify", "--quiet", ref], opts).then(
    (out) => out.trim() || null,
    () => null
  );

/** The checked-out branch, "" when HEAD is detached. */
export const currentBranch = (cwd: string, opts?: GitOptions) =>
  trimmed(git(cwd, ["branch", "--show-current"], opts));

/** `status --porcelain` as printed. */
export const statusPorcelain = (cwd: string, opts?: GitOptions) =>
  git(cwd, ["status", "--porcelain"], opts);

/** Whether `ancestor` is reachable from `ref`; false when git can't say. */
export const isAncestor = (
  cwd: string,
  ancestor: string,
  ref: string,
  opts?: GitOptions
) => gitOk(cwd, ["merge-base", "--is-ancestor", ancestor, ref], opts);

/** The best common ancestor of `a` and `b`. */
export const mergeBase = (
  cwd: string,
  a: string,
  b: string,
  opts?: GitOptions
) => trimmed(git(cwd, ["merge-base", "--end-of-options", a, b], opts));

export const gitFetch = (cwd: string, args: string[] = [], opts?: GitOptions) =>
  git(cwd, ["fetch", ...args], opts);

/** Pushes; resolves stdout then stderr, where git reports what it did. */
export const gitPush = (cwd: string, args: string[], opts?: GitOptions) =>
  gitResult(cwd, ["push", ...args], opts).then(
    ({ stdout, stderr }) => `${stdout}${stderr}`
  );

export const gitRebase = (cwd: string, args: string[], opts?: GitOptions) =>
  git(cwd, ["rebase", ...args], opts);

/** `diff --stat` of `args` (a range, paths), as printed. */
export const diffStat = (cwd: string, args: string[], opts?: GitOptions) =>
  git(cwd, ["diff", "--stat", ...args], opts);

/** Deletes a local branch; `force` deletes it unmerged (-D). */
export const deleteBranch = (
  cwd: string,
  branch: string,
  { force = false, ...opts }: GitOptions & { force?: boolean } = {}
) => git(cwd, ["branch", force ? "-D" : "-d", "--", branch], opts);

export const worktreeAdd = (repo: string, args: string[], opts?: GitOptions) =>
  git(repo, ["worktree", "add", ...args], opts);

export const worktreeRemove = (
  repo: string,
  dir: string,
  { force = 1, ...opts }: GitOptions & { force?: 0 | 1 | 2 } = {}
) =>
  git(
    repo,
    ["worktree", "remove", ...Array(force).fill("--force"), "--", dir],
    opts
  );

export interface WorktreeEntry {
  path: string;
  // Short name, "" when detached.
  branch: string;
  head: string;
}

/** `worktree list --porcelain`, parsed. The main checkout is first. */
export async function worktreeList(
  repo: string,
  opts?: GitOptions
): Promise<WorktreeEntry[]> {
  const out = await git(repo, ["worktree", "list", "--porcelain"], opts);
  return parseWorktreeList(out);
}

export function parseWorktreeList(out: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of out.split("\n\n")) {
    let path = "";
    let branch = "";
    let head = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice(9);
      else if (line.startsWith("branch "))
        branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line.startsWith("HEAD ")) head = line.slice(5);
    }
    if (path) entries.push({ path, branch, head });
  }
  return entries;
}
