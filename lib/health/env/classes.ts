/**
 * The known environment failures: a pattern, a class and the fix to send.
 * Adding a class is one entry here, with a positive and a negative case in
 * classify.test.ts. The first class that matches wins, so a narrower one
 * sits above the broader one it would otherwise be mistaken for.
 */

import type { EnvClass } from "./types";

const USE_ENV =
  "run it through the repo's own environment (`uv run …` when it has a pyproject.toml or uv.lock, else its .venv/bin/python), not a bare `python3`";

export const ENV_CLASSES: readonly EnvClass[] = [
  {
    id: "port-in-use",
    label: "Port taken by another process",
    scope: "shell",
    match: [
      /\bEADDRINUSE\b/,
      /^(?:\S+Error: )?(?:\[Errno \d+\] )?Address already in use\b/i,
      /^(?:Error: )?Port \d+ is already in use\b/,
      /^Something is already running on port \d+/,
      /\bport is already allocated\b/,
    ],
    fix: "A port this command needs is taken by another process on this machine. Don't wait for it and don't stop it: run `aos port <that port>` to see who holds it and get a free one, then start on that one (pass it with --port or PORT=). If you need that exact port, tell the orchestrator.",
  },
  {
    id: "python-version",
    label: "Python too old for the code",
    scope: "shell",
    match: [
      /No module named '?"?tomllib/,
      /^SyntaxError:/,
      /unsupported operand type\(s\) for \|/,
      /requires a different Python/,
      /Python 3\.\d+ or (?:later|newer|above) is required/i,
    ],
    requires:
      /tomllib|requires a different Python|Python 3\.\d+ or |unsupported operand|python3?\.[0-9]\b|Versions\/3\.[0-9]\b|Python\/3\.[0-9]\b/i,
    fix: `This interpreter is too old for the code: ${USE_ENV}.`,
  },
  {
    id: "python-externally-managed",
    label: "pip into a managed Python",
    scope: "shell",
    match: [/externally-managed-environment/],
    fix: "Don't `pip install` into a system or Homebrew Python: use the repo's environment (`uv run`, `uv pip`, or its .venv).",
  },
  {
    id: "python-missing-module",
    label: "Python module not found",
    scope: "shell",
    match: [/^(?:ModuleNotFoundError|ImportError): No module named/],
    fix: `Each Python on this machine has different packages: ${USE_ENV}.`,
  },
  {
    id: "python-not-found",
    label: "python not found",
    scope: "shell",
    match: [
      /command not found: python/,
      /^(?:\S+: )?(?:line \d+: )?python[0-9.]*: (?:command )?not found/,
    ],
    fix: "There is no bare `python` here: call `python3`, or better `uv run` in the repo.",
  },
  {
    id: "macos-automation",
    label: "macOS Automation denied",
    scope: "shell",
    match: [
      /\(-1743\)/,
      /Not authorized to send Apple events/,
      /errAEEventNotPermitted/,
    ],
    fix: "macOS Automation (Apple events) permission was refused for this program. It's a machine setting, not something to retry: tell the orchestrator.",
  },
  {
    id: "local-permission",
    label: "Local permission denied",
    scope: "shell",
    match: [/Permission denied/, /\bEACCES\b/, /Operation not permitted/],
    except: {
      command: /\b(?:ssh|scp|sftp|rsync|kubectl|docker\s+exec)\b/,
      output: /\(publickey/,
    },
    fix: null,
  },
  {
    id: "guard-git-write",
    label: "Guard: git write refused",
    scope: "guard",
    match: [
      /^Refused: git (?:pull|stash|checkout|merge|rebase|reset)\b/,
      /is inside .*, a project repository/,
    ],
    fix: "Orchestrators don't pull or switch a project checkout: `git fetch`, then read the latest with `git show origin/main:<path>`.",
  },
  {
    id: "guard-write",
    label: "Guard: write refused",
    scope: "guard",
    match: [
      /orchestrators never write/,
      /you may write only in your folder/,
      /Change code there through a task/,
    ],
    fix: "Write only in your own folder; change repository code through a task (`start_task`) or a quick change.",
  },
  {
    id: "guard-shell",
    label: "Guard: command refused",
    scope: "guard",
    match: [/^Refused: /],
    fix: null,
  },
];

export const classById = (id: string): EnvClass | undefined =>
  ENV_CLASSES.find((c) => c.id === id);

export const SHELL_TOOLS = new Set([
  "bash",
  "shell",
  "exec_command",
  "run_shell_command",
  "local_shell",
]);

// Commands that show text somebody else wrote: an error in their output is
// in the data, not something this run hit.
export const READERS =
  /^(?:grep|egrep|rg|ag|cat|head|tail|less|more|ls|wc|sed\s+-n|awk|jq|sqlite3|journalctl|echo|printf|aos\s+(?:history|inbox)|sm\s+logs|gh\s+run\s+view|git\s+(?:log|show|diff|grep))\b/;
