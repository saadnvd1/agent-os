/**
 * The shell commands an orchestrator may run, read before the shell sees
 * them. Its permissions allow `aos` commands and `git`; this makes sure each
 * is one plain command (no `;`, `&&`, pipes, redirects, substitutions or
 * globs a shell would act on), and that a git command works only in one of
 * its own quick changes' worktrees (`-C <path>`), does nothing that runs
 * other code or writes outside it, and never pushes: quick_pr pushes, and
 * never to the default branch.
 */

// What git may do in a quick worktree: look, stage, undo. Committing is
// quick_pr's alone: it runs with hooks off, where a shell commit would run
// whatever the project (or the orchestrator's own edit) put in its hooks.
const GIT_ALLOWED = new Set([
  "status",
  "diff",
  "log",
  "show",
  "add",
  "rm",
  "mv",
  "restore",
  "reset",
  "rev-parse",
  "ls-files",
]);

// Options that write a file somewhere else, or read a command to run.
const GIT_REFUSED_ARG =
  /^(--output(-directory)?(=|$)|--exec(=|$)|--ext-diff$|--textconv$)/;

// A shell word, with its quotes taken off, or why the command isn't one
// plain command.
export function shellWords(command: string): string[] | string {
  const words: string[] = [];
  let word: string | null = null;
  const plain =
    "use one plain command: no ;, &&, ||, pipes, redirects, $, backticks, globs or comments outside quotes (quote anything with those)";
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === " " || c === "\t") {
      if (word !== null) words.push(word);
      word = null;
      continue;
    }
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) return "an unclosed ' quote";
      word = (word ?? "") + command.slice(i + 1, end);
      i = end;
      continue;
    }
    if (c === '"') {
      let text = "";
      let j = i + 1;
      for (; j < command.length && command[j] !== '"'; j++) {
        const d = command[j];
        if (d === "$" || d === "`") return plain;
        if (d === "\\" && j + 1 < command.length) {
          const n = command[++j];
          text += /["\\$`\n]/.test(n) ? n : `\\${n}`;
          continue;
        }
        text += d;
      }
      if (j >= command.length) return 'an unclosed " quote';
      word = (word ?? "") + text;
      i = j;
      continue;
    }
    if (c === "\\") {
      if (i + 1 >= command.length || command[i + 1] === "\n") return plain;
      word = (word ?? "") + command[++i];
      continue;
    }
    if (/[;&|<>()$`\n\r*?[\]{}!#]/.test(c)) return plain;
    // zsh expands a word starting with = or ~name; only ~ and ~/ are read
    // (as the home folder), by the caller.
    if (word === null && c === "=") return plain;
    if (word === null && c === "~" && !/^~($|[\s/])/.test(command.slice(i)))
      return plain;
    word = (word ?? "") + c;
  }
  if (word !== null) words.push(word);
  return words;
}

export type GitCommand =
  | { refusal: string }
  | { refusal: null; dir: string | null; sub: string | null };

// A shell command read for the guard: why it's refused outright, or, for a
// git command, the folder it runs in (from -C) to check against its quick
// worktrees. `dir` and `sub` are null for a command that isn't git.
export function readCommand(command: unknown): GitCommand {
  if (typeof command !== "string" || !command.trim())
    return { refusal: "No command to check." };
  const words = shellWords(command.trim());
  if (typeof words === "string") return { refusal: `Refused: ${words}.` };
  if (words[0] !== "git") {
    // `VAR=value git …` sets an environment variable the shell would act on
    // (GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE), which can redirect git
    // outside its quick worktree.
    if (words[0].includes("="))
      return {
        refusal:
          "Refused: set the environment in your shell first, not inline; GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE can point git outside your worktree.",
      };
    return { refusal: null, dir: null, sub: null };
  }
  const usage =
    "git runs only in one of your quick changes' worktrees, as `git -C <its path> <command>`";
  let dir: string | null = null;
  let i = 1;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === "-C") {
      if (dir !== null || i + 1 >= words.length)
        return { refusal: `Refused: ${usage}, with one -C.` };
      dir = words[++i];
      continue;
    }
    if (w === "--no-pager" || w === "--no-optional-locks") continue;
    if (w.startsWith("-"))
      return {
        refusal: `Refused: git's ${w} option isn't allowed here; ${usage}.`,
      };
    break;
  }
  if (dir === null) return { refusal: `Refused: ${usage}.` };
  const sub = words[i] ?? null;
  if (sub === "push")
    return {
      refusal:
        "Refused: quick_pr pushes a quick change's branch and opens its PR; nothing pushes from the shell, and nothing ever pushes to the default branch.",
    };
  if (!sub || !GIT_ALLOWED.has(sub))
    return {
      refusal: `Refused: git ${sub ?? ""} isn't allowed here. In a quick worktree git may only ${[...GIT_ALLOWED].join(", ")}; quick_pr commits, pushes and opens the PR.`,
    };
  const bad = words.slice(i + 1).find((w) => GIT_REFUSED_ARG.test(w));
  if (bad)
    return {
      refusal: `Refused: git's ${bad} option writes or runs something outside the worktree.`,
    };
  return { refusal: null, dir, sub };
}
