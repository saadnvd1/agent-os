/**
 * What a fork child may not do (the checks run in its chat worker before
 * every tool call, whatever its permissions say). It has its parent's tools
 * and access; this only keeps it from changing the parent's checkout, which
 * the parent keeps working in, and from anything that ships: no push, no
 * PR, no fork of its own. Temp work goes in its scratch folder; a child
 * that has to edit code gets its own throwaway checkout (`--worktree`).
 *
 * Like the orchestrator's guard it reads honest mistakes, not a determined
 * bypass: an interpreter's inline code or a script can write anything.
 */

import fs from "fs";
import path from "path";
import type { ToolGuard, ToolGuardResult } from "../chat/driver";
import { heavyLabel } from "../load/heavy";
import {
  invocations,
  positionals,
  type Invocation,
} from "../orchestrator/shell-guard";
import { parseShell, UNKNOWN } from "../orchestrator/shell-parse";
import { physicalPath, WRITE_TOOLS, within } from "../orchestrator/write-guard";

export interface ForkGuardContext {
  // The parent's checkout: never changed from here.
  parentCheckout: string;
  // The child's scratch folder: free to write.
  scratch: string;
  // Its own throwaway checkout, when it has one: free to write.
  ownCheckout: string | null;
  // Where the child runs; relative paths start here.
  cwd: string;
}

const WHERE = (c: ForkGuardContext) =>
  c.ownCheckout
    ? `work in your own checkout (${c.ownCheckout}) or ${c.scratch}`
    : `put temp work in ${c.scratch} (AOS_SCRATCH), or ask for \`aos fork --worktree\` to edit code`;

const noWrite = (c: ForkGuardContext, what: string) =>
  `Refused: ${what} would change the parent's checkout, which it is working in. ${WHERE(c)}.`;

// Commands whose every path argument is something they change.
const MUTATORS = new Set([
  "rm",
  "rmdir",
  "mv",
  "touch",
  "mkdir",
  "ln",
  "install",
  "truncate",
  "chmod",
  "chown",
  "tee",
  "unlink",
  "shred",
  "patch",
  "ditto",
]);
const GIT_CHANGES_TREE = new Set([
  "add",
  "commit",
  "checkout",
  "switch",
  "reset",
  "restore",
  "stash",
  "apply",
  "merge",
  "rebase",
  "clean",
  "cherry-pick",
  "revert",
  "rm",
  "mv",
  "pull",
  "am",
  "bisect",
  "submodule",
]);
const GIT_CHANGES_REFS = new Set([
  "update-ref",
  "symbolic-ref",
  "gc",
  "prune",
  "worktree",
  "replace",
  "filter-branch",
  "stash",
]);
const INSTALLS = new Set([
  "install",
  "i",
  "add",
  "ci",
  "remove",
  "rm",
  "uninstall",
  "update",
  "up",
  "link",
  "dedupe",
  "prune",
]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

const expand = (word: string, ctx: ForkGuardContext) =>
  word
    .replaceAll("${AOS_SCRATCH}", ctx.scratch)
    .replaceAll("$AOS_SCRATCH", ctx.scratch);

async function real(p: string, base: string): Promise<string | null> {
  if (p.includes(UNKNOWN)) return null;
  try {
    return await physicalPath(path.resolve(base, p));
  } catch {
    return null;
  }
}

// Whether a path is somewhere the child may not write.
async function protectedPath(
  p: string,
  base: string,
  c: ForkGuardContext
): Promise<boolean> {
  const r = await real(p, base);
  if (!r) return false;
  const [parent, scratch, own] = await Promise.all([
    physicalPath(c.parentCheckout),
    physicalPath(c.scratch),
    c.ownCheckout ? physicalPath(c.ownCheckout) : Promise.resolve(null),
  ]);
  if (within(r, scratch) || (own && within(r, own))) return false;
  return within(r, parent);
}

// A file tool's refusal, or null.
export async function fileRefusal(
  c: ForkGuardContext,
  tool: string,
  input: Record<string, unknown>
): Promise<ToolGuardResult> {
  const arg = WRITE_TOOLS[tool];
  if (!arg) return null;
  const file = input[arg];
  if (typeof file !== "string") return "No file path to check.";
  return (await protectedPath(file, c.cwd, c))
    ? noWrite(c, `${tool} on ${file}`)
    : null;
}

const gitSub = (args: string[]) => {
  const rest = [...args];
  while (rest.length) {
    const a = rest[0];
    if (a === "-C" || a === "-c" || a === "--git-dir" || a === "--work-tree")
      rest.splice(0, 2);
    else if (a.startsWith("-")) rest.shift();
    else break;
  }
  return rest;
};

const gitDir = (args: string[], cwd: string): string => {
  const i = args.indexOf("-C");
  return i >= 0 && args[i + 1] ? path.resolve(cwd, args[i + 1]) : cwd;
};

async function invocationRefusal(
  inv: Invocation,
  cwd: string,
  c: ForkGuardContext
): Promise<string | null> {
  const { name, args } = inv;
  const pos = positionals(args);
  if (name === "aos") {
    if (pos[0] === "fork")
      return "Refused: a fork can't start forks. Do the work yourself, or say in your return what should be split off.";
    if (pos[0] === "heavy") return null;
  }
  if (name === "git" || name === "gh") {
    if (name === "git" && pos[0] === "push")
      return "Refused: a fork never pushes. Report what you found in `aos return`.";
    if (
      name === "gh" &&
      pos[0] === "pr" &&
      /^(create|merge|close|edit|ready|reopen|review|comment)$/.test(
        pos[1] ?? ""
      )
    )
      return "Refused: a fork never opens or changes a PR. Report what you found in `aos return`.";
  }
  const heavy = heavyLabel([name, ...args].join(" "));
  if (heavy)
    return `Refused: a whole ${heavy} run goes through \`aos heavy -- <command>\`, which queues fork runs so several forks don't load the machine at once.`;

  if (name === "git") {
    const sub = gitSub(args);
    const verb = sub[0] ?? "";
    const dir = gitDir(args, cwd);
    if (
      GIT_CHANGES_REFS.has(verb) ||
      (verb === "branch" &&
        !sub
          .slice(1)
          .every((a) =>
            /^(-l|--list|-a|-r|-v|-vv|--show-current|--contains|--merged|--no-merged)$/.test(
              a
            )
          )) ||
      (verb === "tag" &&
        sub.length > 1 &&
        !sub.slice(1).every((a) => /^(-l|--list|-n\d*)$/.test(a)))
    )
      return `Refused: git ${verb} would change the repository's shared state. Read with log, show, diff and status; ${WHERE(c)}.`;
    if (GIT_CHANGES_TREE.has(verb) && (await protectedPath(".", dir, c)))
      return noWrite(c, `git ${verb}`);
  }
  if (PACKAGE_MANAGERS.has(name)) {
    const verb =
      args[0] === "run" || args[0]?.startsWith("-") ? "" : (args[0] ?? "");
    if (INSTALLS.has(verb)) {
      const prefix = args.findIndex(
        (a) => a === "--prefix" || a === "-C" || a === "--cwd"
      );
      const dir =
        prefix >= 0 && args[prefix + 1]
          ? path.resolve(cwd, args[prefix + 1])
          : cwd;
      if (await protectedPath(".", dir, c))
        return noWrite(c, `${name} ${verb}`);
      if (c.ownCheckout && within(dir, c.ownCheckout)) {
        const linked = await fs.promises
          .lstat(path.join(c.ownCheckout, "node_modules"))
          .then(
            (s) => s.isSymbolicLink(),
            () => false
          );
        if (linked)
          return `Refused: ${name} ${verb} here would write through the link to the parent's packages. Say in your return which packages you needed.`;
      }
    }
  }
  if (
    /^(vitest|jest|npx|pnpm|yarn|npm|bun)$/.test(name) &&
    args.some((a) =>
      /^(--update|-u|--update-snapshot|--updateSnapshot)$/.test(a)
    ) &&
    (await protectedPath(".", cwd, c))
  )
    return noWrite(c, "updating snapshots");
  if (MUTATORS.has(name)) {
    for (const t of pos)
      if (await protectedPath(expand(t, c), cwd, c))
        return noWrite(c, `${name} ${t}`);
  }
  if (name === "cp" && pos.length > 1) {
    const dest = pos[pos.length - 1];
    if (await protectedPath(expand(dest, c), cwd, c))
      return noWrite(c, `cp to ${dest}`);
  }
  if (name === "sed" && args.some((a) => /^(-[a-zA-Z]*i|--in-place)/.test(a))) {
    for (const t of pos.slice(1))
      if (await protectedPath(expand(t, c), cwd, c))
        return noWrite(c, `sed -i ${t}`);
  }
  if (name === "perl" && args.some((a) => /^-[a-zA-Z]*i/.test(a))) {
    for (const t of pos)
      if (await protectedPath(expand(t, c), cwd, c))
        return noWrite(c, `perl -i ${t}`);
  }
  if (name === "dd") {
    const of = args.find((a) => a.startsWith("of="));
    if (of && (await protectedPath(of.slice(3), cwd, c)))
      return noWrite(c, "dd");
  }
  return null;
}

// A shell command line's refusal, or null.
export async function shellRefusal(
  c: ForkGuardContext,
  command: unknown
): Promise<string | null> {
  if (typeof command !== "string" || !command.trim())
    return "Refused: no command to check.";
  const parsed = parseShell(expand(command, c));
  if (typeof parsed === "string") return `Refused: ${parsed}.`;
  let cwd = c.cwd;
  for (const cmd of parsed) {
    const invs = invocations(cmd);
    if (typeof invs === "string") return `Refused: ${invs}.`;
    for (const f of cmd.writes) {
      if (f === "/dev/null" || f.startsWith("/dev/fd/")) continue;
      if (await protectedPath(f, cwd, c))
        return noWrite(c, `redirecting to ${f}`);
    }
    for (const inv of invs) {
      if (inv.name === "cd" || inv.name === "pushd") {
        const to = positionals(inv.args)[0];
        cwd = !to
          ? cwd
          : to.includes(UNKNOWN) || to === "-"
            ? cwd
            : path.resolve(cwd, to);
        continue;
      }
      const why = await invocationRefusal(inv, cwd, c);
      if (why) return why;
    }
  }
  return null;
}

export function forkToolGuard(c: ForkGuardContext): ToolGuard {
  return async (tool, input) => {
    if (tool === "Bash") return shellRefusal(c, input.command);
    return fileRefusal(c, tool, input);
  };
}
