import fs from "fs";
import os from "os";
import path from "path";
import { isOrchestratorSecretPath as isSecretPath } from "../secret-paths";
import { TOOL_NAMES } from "./tool-names";
import { parseShell, UNKNOWN, type SimpleCommand } from "./shell-parse";

/**
 * The orchestrator's shell runs anything (Saad's call, 2026-10-11), except
 * this deny list: merging, closing or retargeting a PR outside the gates,
 * pushing, writing in a project repository or task worktree other than its
 * own quick changes, writing AgentOS's own state, stopping AgentOS or its
 * tmux, and reading secrets. Each is caught in its plain shape and the
 * common wrappers (`bash -c`, `env`, `sudo`, `xargs`, `find -exec`, an
 * absolute path, `git -C`, inside pipes, chains and substitutions), and
 * refused with the tool to use instead. It catches honest mistakes, not a
 * determined bypass: `python -c` or a script can do any of these unseen.
 */

export interface ShellContext {
  // Where the shell starts; a `cd` in the line moves it.
  cwd: string;
  // Why a write to this path is refused (a project repository or task
  // worktree that isn't its own quick change, AgentOS's state outside its
  // folder), or null.
  writeRefusal: (p: string) => Promise<string | null>;
  // Whether this file is AgentOS's database or other state of its own.
  isAgentOsState: (p: string) => Promise<boolean>;
  // Whether this path is under ~/.agent-os/audits, where reports go and
  // nothing may be made executable.
  inAudits?: (p: string) => Promise<boolean>;
  // What a folder is for fast-forwarding: a project checkout of this
  // workspace ("own"), the checkout AgentOS's live server and autodeploy run
  // from ("live"), or anything else.
  checkoutKind?: (dir: string) => Promise<"own" | "live" | "other">;
  // AgentOS's server and the tmux servers it runs sessions in.
  protectedPids: () => Promise<Set<number>>;
}

interface Invocation {
  name: string;
  args: string[];
  cmd: SimpleCommand;
}

const T = TOOL_NAMES;

const has = (w: string) => w.includes(UNKNOWN);
const show = (w: string) => w.replaceAll(UNKNOWN, "$(…)");

// Commands that only run the rest of their arguments, and their options
// that take a value.
const WRAPPERS: Record<string, string[]> = {
  env: ["-u", "--unset", "-C", "--chdir"],
  sudo: ["-u", "-g", "-C", "-h", "-p", "-U", "-r", "-t", "-T", "-D"],
  command: [],
  builtin: [],
  exec: ["-a"],
  nohup: [],
  time: [],
  noglob: [],
  nice: ["-n"],
  stdbuf: ["-i", "-o", "-e"],
  caffeinate: ["-t", "-w"],
  timeout: ["-s", "--signal", "-k", "--kill-after"],
  gtimeout: ["-s", "--signal", "-k", "--kill-after"],
  xargs: ["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a", "--max-args"],
  watch: ["-n", "--interval"],
};

const KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "while",
  "until",
  "!",
  "{",
  "}",
]);

const SHELLS = /^(ba|z|da|k|fi|c|tc)?sh$/;

// What a simple command runs once its wrappers are taken off: one
// invocation, or several (`bash -c '…'`, `find -exec`).
function invocations(cmd: SimpleCommand, depth = 0): Invocation[] | string {
  let words = cmd.words;
  for (;;) {
    while (
      words.length &&
      (KEYWORDS.has(words[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))
    )
      words = words.slice(1);
    if (!words.length) return [];
    const name = path.basename(words[0]);
    const rest = words.slice(1);
    if (SHELLS.test(name) || name === "eval" || name === "watch") {
      const script = shellScript(name, rest);
      if (script === null) return [{ name, args: rest, cmd }];
      return nested(script, cmd, depth);
    }
    if (name === "env") {
      const s = rest.findIndex((w) => w === "-S" || w === "--split-string");
      if (s >= 0) return nested(rest.slice(s + 1).join(" "), cmd, depth);
    }
    const opts = WRAPPERS[name];
    if (opts) {
      let i = 0;
      for (; i < rest.length && rest[i].startsWith("-"); i++)
        if (opts.includes(rest[i])) i++;
      if (name === "timeout" || name === "gtimeout") i++;
      words = rest.slice(i);
      // xargs adds arguments that come from its input.
      if (name === "xargs" && words.length) words = [...words, UNKNOWN];
      continue;
    }
    if (name === "find") return findInvocations(rest, cmd, depth);
    return [{ name, args: rest, cmd }];
  }
}

function shellScript(name: string, args: string[]): string | null {
  if (name === "eval") return args.join(" ");
  if (name === "watch") {
    let i = 0;
    for (; i < args.length && args[i].startsWith("-"); i++)
      if (WRAPPERS.watch.includes(args[i])) i++;
    return args.slice(i).join(" ") || null;
  }
  const c = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
  if (c < 0) return null;
  return args.slice(c + 1).find((a) => !a.startsWith("-")) ?? "";
}

function nested(
  script: string,
  cmd: SimpleCommand,
  depth: number
): Invocation[] | string {
  if (depth > 8) return "commands nested too deeply to check";
  const parsed = parseShell(script, depth + 1);
  if (typeof parsed === "string") return parsed;
  const out: Invocation[] = [];
  for (const inner of parsed) {
    const r = invocations(
      {
        ...inner,
        writes: [...inner.writes, ...cmd.writes],
        stdin: inner.stdin + cmd.stdin,
      },
      depth + 1
    );
    if (typeof r === "string") return r;
    out.push(...r);
  }
  return out;
}

// find's -exec commands, and -delete as an rm of the folders it searches.
function findInvocations(
  args: string[],
  cmd: SimpleCommand,
  depth: number
): Invocation[] | string {
  const out: Invocation[] = [{ name: "find", args, cmd }];
  const first = args.findIndex((a) => /^[-(!]/.test(a));
  const roots = args.slice(0, first < 0 ? args.length : first);
  if (args.includes("-delete")) out.push({ name: "rm", args: roots, cmd });
  for (let i = 0; i < args.length; i++) {
    if (!/^-(exec|execdir|ok|okdir)$/.test(args[i])) continue;
    const end = args.findIndex((a, j) => j > i && (a === ";" || a === "+"));
    const words = args.slice(i + 1, end < 0 ? args.length : end);
    const r = invocations({ ...cmd, words, writes: [] }, depth + 1);
    if (typeof r === "string") return r;
    out.push(...r);
    i = end < 0 ? args.length : end;
  }
  return out;
}

// Words that aren't options; `--` ends options. `values` take the next word.
function positionals(args: string[], values: string[] = []): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") return [...out, ...args.slice(i + 1)];
    if (a.startsWith("-") && a.length > 1) {
      if (values.includes(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

// An option's values, given as `-X v`, `-Xv`, `--opt v` or `--opt=v`.
function optionValues(args: string[], short: string[], long: string[]) {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ([...short, ...long].includes(a)) out.push(args[++i] ?? "");
    else if (long.some((l) => a.startsWith(`${l}=`)))
      out.push(a.slice(a.indexOf("=") + 1));
    else if (short.some((s) => a.startsWith(s) && a.length > s.length))
      out.push(a.slice(2));
  }
  return out;
}

const MERGE_MUTATION =
  /\b(mergePullRequest|closePullRequest|updatePullRequest|updatePullRequestBranch|enablePullRequestAutoMerge|mergeBranch)\b/;
const PULL = /(^|\/)pulls\/[^/?\s]+/;
const PULL_MERGE = /(^|\/)pulls\/[^/?\s]+\/merge\/?(\?|$)/;

const MERGE_MSG = `Refused: a PR merges only through the gates: ${T.sign_off} (or ${T.arm}) for a task's or an external PR, ${T.land} for a stack. Nothing merges, closes or retargets a PR from the shell.`;

// aos move, done, archive, resurrect, stop and drop reach a session by name, past the tools'
// Pause check and logging; the tools do the same work.
function aosRefusal(args: string[]): string | null {
  const [sub] = positionals(args);
  const tool: Record<string, string> = {
    move: T.move,
    done: T.done,
    archive: T.archive,
    resurrect: T.resurrect,
    stop: T.stop,
  };
  if (sub && tool[sub])
    return `Refused: \`aos ${sub}\` isn't for you; use ${tool[sub]}, which is scoped to this workspace and held by Pause.`;
  return null;
}

// gh: pr merge, close and edit --base, and api calls that merge or change a
// pull request.
function ghRefusal(args: string[]): string | null {
  const values = [
    "-R",
    "--repo",
    "-X",
    "--method",
    "-H",
    "--header",
    "-f",
    "-F",
    "--field",
    "--raw-field",
    "--input",
    "-q",
    "--jq",
    "-t",
    "--template",
    "--hostname",
    "-p",
    "--preview",
    "--cache",
  ];
  const [group, sub] = positionals(args, values);
  if (group === "pr" && sub === "merge") return MERGE_MSG;
  if (group === "pr" && sub === "close")
    return `Refused: close a task's PR with ${T.drop}, which also removes its worktree; nothing closes a PR from the shell.`;
  if (
    group === "pr" &&
    sub === "edit" &&
    optionValues(args, ["-B"], ["--base"]).length
  )
    return `Refused: retargeting a PR changes what its gates judged; a stack sets its own bases (${T.stack}), and anything else is Saad's call (${T.ask_saad}).`;
  if (group !== "api") return null;
  const endpoint = positionals(args, values)[1] ?? "";
  const method = optionValues(args, ["-X"], ["--method"]).pop();
  const fields = args.some((a) =>
    /^(-f|-F|--field|--raw-field|--input)(=|$)|^-[fF]./.test(a)
  );
  const effective = (method ?? (fields ? "POST" : "GET")).toUpperCase();
  return requestRefusal(endpoint, effective, args.join(" "));
}

function requestRefusal(
  url: string,
  method: string,
  body: string
): string | null {
  if (PULL_MERGE.test(url) && method !== "GET" && method !== "HEAD")
    return MERGE_MSG;
  if (PULL.test(url) && (method === "PATCH" || method === "PUT"))
    return MERGE_MSG;
  if (/graphql/.test(url) && MERGE_MUTATION.test(body)) return MERGE_MSG;
  return null;
}

function curlRefusal(args: string[]): string | null {
  const method = optionValues(args, ["-X"], ["--request"]).pop();
  const data = args.some((a) =>
    /^(-d|-F|--data|--data-\w+|--json|--form|-T|--upload-file)(=|$)|^-[dFT]./.test(
      a
    )
  );
  const effective = (method ?? (data ? "POST" : "GET")).toUpperCase();
  for (const url of args.filter((a) => /^https?:\/\//i.test(a))) {
    const r = requestRefusal(url, effective, args.join(" "));
    if (r) return r;
  }
  return null;
}

// What changes a repository's files, history or branches.
const GIT_WRITES = new Set([
  "commit",
  "reset",
  "checkout",
  "switch",
  "restore",
  "rebase",
  "merge",
  "pull",
  "cherry-pick",
  "revert",
  "am",
  "apply",
  "stash",
  "clean",
  "rm",
  "mv",
]);

const READ_ONLY_STASH = new Set(["list", "show"]);

// What an orchestrator may do to a project checkout of its own workspace:
// bring it up to date and move its branch (Saad, 2026-10-18). Commits, stash,
// clean and file edits still go through tasks and quick changes.
const CHECKOUT_UPDATES = new Set([
  "pull",
  "merge",
  "reset",
  "checkout",
  "switch",
  "rebase",
]);

async function gitRefusal(
  inv: Invocation,
  ctx: ShellContext,
  cwd: string
): Promise<string | null> {
  const args = inv.args;
  // Every repository the command names: the folder after each -C, and each
  // git dir and work tree, by option or environment.
  const named = new Set<string>();
  let dir = cwd;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === "-C" || a === "--git-dir" || a === "--work-tree") {
      const to = path.resolve(dir, args[++i] ?? "");
      if (a === "-C") dir = to;
      named.add(to);
      continue;
    }
    const eq = /^--(git-dir|work-tree)=(.*)$/.exec(a);
    if (eq) {
      named.add(path.resolve(dir, eq[2]));
      continue;
    }
    if (a === "-c" || a === "--namespace" || a === "--exec-path") {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    break;
  }
  named.add(dir);
  for (const w of inv.cmd.words) {
    const env = /^GIT_(?:DIR|WORK_TREE)=(.*)$/.exec(w);
    if (env) named.add(path.resolve(cwd, env[1]));
  }
  const sub = args[i];
  if (sub === "push")
    return `Refused: ${T.quick_pr} pushes a quick change's branch and opens its PR, and tasks push their own; nothing pushes from the orchestrator's shell.`;
  if (!GIT_WRITES.has(sub)) return null;
  if (sub === "stash" && READ_ONLY_STASH.has(args[i + 1])) return null;
  for (const d of named) {
    if (has(d))
      return `Refused: git ${sub} in a folder only the shell knows (${show(d)}); name the folder.`;
    if (!(await ctx.writeRefusal(d))) continue;
    const kind = (await ctx.checkoutKind?.(d)) ?? "other";
    const updates = CHECKOUT_UPDATES.has(sub);
    if (kind === "live" && updates)
      return `Refused: git ${sub} in ${d}. This is the checkout AgentOS's live server runs from; autodeploy deploys it (restart gap and health check), and changing it here would swap the code under the running server. For a manual deploy use scripts/redeploy.`;
    if (kind === "own" && updates) continue;
    return `Refused: git ${sub} in ${d}. Orchestrators don't change project checkouts except to update them: in a project checkout of your own workspace you may \`git pull\` (any form), \`merge\`, \`reset\`, \`checkout\`, \`switch\` and \`rebase\`. Commits, \`stash\`, \`clean\`, \`restore\` and file edits go through ${T.start_task} or ${T.quick_change}; other workspaces' repositories, task worktrees and AgentOS's live checkout are never changed from here. To see current code: \`git -C ${d} fetch\` then \`git -C ${d} show origin/main:<path>\` or \`git -C ${d} log origin/main\`.`;
  }
  return null;
}

// Commands whose every non-option argument is a file they change, and
// those whose last one is.
const WRITES_ALL = new Set([
  "rm",
  "rmdir",
  "unlink",
  "touch",
  "truncate",
  "mkdir",
  "tee",
  "shred",
  "mv",
  "chmod",
  "chown",
  "chgrp",
]);
const WRITES_LAST = new Set(["cp", "ln", "install", "rsync", "ditto"]);

// Whether this chmod mode adds an execute bit (or might: copying another
// class's bits, or a mode it can't read).
export function addsExecute(mode: string): boolean {
  if (/^[0-7]{1,4}$/.test(mode)) return [...mode.slice(-3)].some((d) => +d & 1);
  return mode.split(",").some((c) => {
    const m = /^[ugoa]*([-+=])([rwxXst]*|[ugo])$/.exec(c);
    return !m || (m[1] !== "-" && /[xXugo]/.test(m[2]));
  });
}

function writtenFiles(inv: Invocation): string[] {
  const { name, args } = inv;
  const files = [...inv.cmd.writes];
  if (WRITES_ALL.has(name)) {
    const pos = positionals(args, ["-s", "-m", "--size", "--mode"]);
    files.push(...(/^ch(mod|own|grp)$/.test(name) ? pos.slice(1) : pos));
  }
  if (WRITES_LAST.has(name)) {
    const target = optionValues(args, ["-t"], ["--target-directory"]);
    files.push(...target);
    const pos = positionals(args, ["-t", "--target-directory"]);
    if (!target.length && pos.length > 1) files.push(pos[pos.length - 1]);
  }
  if (name === "dd")
    files.push(
      ...args.filter((a) => a.startsWith("of=")).map((a) => a.slice(3))
    );
  if (name === "sed" && args.some((a) => /^(-i|--in-place)/.test(a))) {
    const script = args.some((a) => a === "-e" || a === "-f") ? 0 : 1;
    files.push(...positionals(args, ["-e", "-f"]).slice(script));
  }
  return files;
}

const SQL_WRITE =
  /\b(insert|update|delete|drop|alter|attach|create|vacuum|reindex)\b|load_extension|writefile|^\s*\.(restore|import|load|shell|system|save|clone)/im;
const SQLITE_VALUES = [
  "-cmd",
  "-init",
  "-separator",
  "-newline",
  "-nullvalue",
  "-vfs",
  "-mmap",
  "-maxsize",
  "-lookaside",
  "-pagecache",
  "-heap",
  "-escape",
];

async function sqliteRefusal(
  inv: Invocation,
  ctx: ShellContext,
  cwd: string,
  raw: string
): Promise<string | null> {
  const [db, ...sql] = positionals(inv.args, SQLITE_VALUES);
  if (!db || has(db)) return null;
  const file = db.replace(/^file:/, "").replace(/\?.*$/, "");
  if (!(await ctx.isAgentOsState(path.resolve(cwd, file)))) return null;
  const fix = `open it with -readonly and only read (SELECT, PRAGMA, .schema, .tables); change AgentOS through your tools (${T.note}, ${T.rule_add}, ${T.drop}, ${T.stop} and the rest).`;
  if (!inv.args.some((a) => a === "-readonly" || a === "--readonly"))
    return `Refused: sqlite3 on AgentOS's own state; ${fix}`;
  if (inv.args.some((a) => a === "-init" || a === "--init"))
    return `Refused: sqlite3 -init on AgentOS's state runs SQL this can't check; ${fix}`;
  const text = [
    ...sql,
    ...optionValues(inv.args, [], ["-cmd"]),
    inv.cmd.stdin,
    // SQL piped in from another command is somewhere in the line.
    ...(sql.length ? [] : [raw]),
  ].join("\n");
  return SQL_WRITE.test(text)
    ? `Refused: that SQL would change AgentOS's state; ${fix}`
    : null;
}

const SERVER_PATTERN = /node|tsx|server|agent-?os|tmux|next/i;
const STOP_MSG = `Refused: never stop or restart AgentOS or its tmux; that ends every session it runs, this one included. Stop a session with ${T.stop} or finish it with ${T.done}, and if AgentOS itself needs a restart, ${T.ask_saad}.`;

async function stopRefusal(
  inv: Invocation,
  ctx: ShellContext
): Promise<string | null> {
  const { name, args } = inv;
  if (name === "tmux" && args.some((a) => /^kill/.test(a))) return STOP_MSG;
  if (
    (name === "pkill" || name === "killall") &&
    positionals(args, ["-u", "-U", "-g", "-G", "-t", "-s", "-F"]).some(
      (a) => has(a) || SERVER_PATTERN.test(a)
    )
  )
    return STOP_MSG;
  if (name === "launchctl" || name === "sm" || name === "serviceman") {
    const verb = positionals(args)[0] ?? "";
    if (
      !/^(list|ls|print|status|logs?|blame)$/.test(verb) &&
      args.some((a) => /agent-?os/i.test(a))
    )
      return STOP_MSG;
  }
  if (name === "kill") {
    const targets = positionals(args, ["-s", "-n"]).concat(
      // After --, a negative number is a process group.
      args.includes("--")
        ? []
        : args.filter((a) => /^-\d+$/.test(a) && args.indexOf(a) > 0)
    );
    if (args.includes("-l") || args.includes("-L")) return null;
    if (!targets.length) return null;
    for (const t of targets) {
      if (t.startsWith("%")) continue;
      if (has(t) || !/^\d+$/.test(t))
        return `Refused: kill a process by its number, read first, so it's never AgentOS's (${show(t)} is only known to the shell). ${STOP_MSG.slice(9)}`;
      if (Number(t) <= 1) return STOP_MSG;
    }
    const guarded = await ctx.protectedPids();
    if (targets.some((t) => guarded.has(Number(t)))) return STOP_MSG;
  }
  return null;
}

const SECRET_MSG = `Refused: orchestrators never read secrets (env files, keys, credential stores). If a step needs one, ${T.ask_saad}.`;

// Orchestrators may read tokenvault's folders (and run `tv`); writing them
// is still refused by the write guard.
const TOKENVAULT_DIR = /(^|\/)tokenvault(\/|$)/;

function secretRefusal(inv: Invocation, cwd: string): string | null {
  for (const w of [...inv.args, ...inv.cmd.reads]) {
    for (const p of [
      w,
      ...(w.includes("=") ? [w.slice(w.indexOf("=") + 1)] : []),
    ]) {
      if (!p || has(p) || /\s|:\/\//.test(p)) continue;
      const pathish =
        /\//.test(p) ||
        p.startsWith(".") ||
        fs.existsSync(path.resolve(cwd, p));
      if (
        pathish &&
        isSecretPath(p) &&
        !TOKENVAULT_DIR.test(path.resolve(cwd, p))
      )
        return SECRET_MSG;
    }
  }
  return null;
}

// Why this command line is refused, or null.
export async function shellRefusal(
  command: unknown,
  ctx: ShellContext
): Promise<string | null> {
  if (typeof command !== "string" || !command.trim())
    return "No command to check.";
  const parsed = parseShell(command);
  if (typeof parsed === "string") return `Refused: ${parsed}.`;
  let cwd = ctx.cwd;
  for (const cmd of parsed) {
    const invs = invocations(cmd);
    if (typeof invs === "string") return `Refused: ${invs}.`;
    for (const inv of invs) {
      if (inv.name === "cd" || inv.name === "pushd") {
        const to = positionals(inv.args)[0];
        // Somewhere only the shell knows: a git write after it is refused.
        if (!to) cwd = os.homedir();
        else cwd = has(to) || to === "-" ? UNKNOWN : path.resolve(cwd, to);
        continue;
      }
      const why =
        secretRefusal(inv, cwd) ??
        (inv.name === "gh" ? ghRefusal(inv.args) : null) ??
        (inv.name === "curl" ? curlRefusal(inv.args) : null) ??
        (inv.name === "aos" ? aosRefusal(inv.args) : null) ??
        (inv.name === "git" ? await gitRefusal(inv, ctx, cwd) : null) ??
        (inv.name === "sqlite3"
          ? await sqliteRefusal(inv, ctx, cwd, command)
          : null) ??
        (await stopRefusal(inv, ctx));
      if (why) return why;
      for (const f of writtenFiles(inv)) {
        if (has(f) || f === "/dev/null" || f.startsWith("/dev/fd/")) continue;
        if (has(cwd) && !f.startsWith("/")) continue;
        const r = await ctx.writeRefusal(path.resolve(cwd, f));
        if (r) return `Refused: ${inv.name} would write ${f}. ${r}`;
        if (
          inv.name === "chmod" &&
          ctx.inAudits &&
          (await ctx.inAudits(path.resolve(cwd, f))) &&
          addsExecute(
            inv.args.find((a) => !/^(-[RHLPfvhc]+|--.*)$/.test(a)) ?? ""
          )
        )
          return `Refused: chmod would make ${f} executable. ~/.agent-os/audits holds reports, not programs.`;
      }
    }
  }
  return null;
}
