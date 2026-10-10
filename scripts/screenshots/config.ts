import fs from "fs";
import os from "os";
import path from "path";

// Everything the demo touches lives under one throwaway root: the database,
// a fake home with its own git repos, and a tmux server of its own. Nothing
// is read from, or written to, the machine's real home or tmux server.
export const ROOT = process.env.AGENTOS_DEMO_ROOT || "/tmp/agentos-demo";
export const USER = "alex";
export const HOME = path.join(ROOT, "home", USER);
export const CODE = path.join(HOME, "code");
export const BIN = path.join(ROOT, "bin");
export const TMUX_TMPDIR = path.join(ROOT, "tmux");

// The demo tmux server's socket, named outright. With only TMUX_TMPDIR set,
// tmux falls back to /tmp when that directory doesn't exist yet, and a
// "kill-server" there takes down the real server and every session on it
// (2026-10-06). So demo tmux commands always say -S.
export const TMUX_SOCKET = path.join(
  TMUX_TMPDIR,
  `tmux-${process.getuid?.() ?? 0}`,
  "default"
);

export function demoTmuxArgs(args: string[]): string[] {
  return ["-S", TMUX_SOCKET, ...args];
}
export const DB_PATH = path.join(ROOT, "agent-os.db");
export const SCREENS = path.join(ROOT, "screens");
export const RAW = path.join(ROOT, "raw");
export const PORT = Number(process.env.AGENTOS_DEMO_PORT || 3340);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
// What the browser opens: localhost is a secure context, so ask cards
// show their Approve button rather than the passkey notice.
export const PAGE_URL = `http://localhost:${PORT}`;
// The fake linked machine's AgentOS (peer.ts).
export const PEER_PORT = PORT + 1;

export const REPO = path.resolve(__dirname, "..", "..");
export const OUT = path.join(REPO, "screenshots");

// Strings that must never reach a screenshot: anything from the real
// machine. The page text is checked against these before every capture.
export function forbiddenStrings(): string[] {
  const real = [process.env.USER, process.env.LOGNAME]
    .filter((s): s is string => !!s && s !== USER)
    .map((s) => s.toLowerCase());
  const host = os.hostname().split(".")[0].toLowerCase();
  return [
    ...new Set([
      ...real,
      host,
      "/users/",
      "/tmp/",
      "/private/",
      "100.",
      // Anything else private to this machine, e.g. "laptop-name,work-repo".
      ...(process.env.AGENTOS_DEMO_FORBID ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ]),
  ];
}

// The first shell this machine has: zsh on a Mac, often only bash or sh on
// Linux.
export function demoShell(exists = fs.existsSync): string {
  const shells = ["zsh", "bash", "sh"].flatMap((s) => [
    `/bin/${s}`,
    `/usr/bin/${s}`,
  ]);
  return shells.find((s) => exists(s)) ?? "/bin/sh";
}

// System bin directories that exist here (Homebrew's only where it's
// installed), after the demo's own and node's.
export function demoPath(exists = fs.existsSync): string {
  const system = [
    "/opt/homebrew/bin",
    "/home/linuxbrew/.linuxbrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter((d) => exists(d));
  return [BIN, path.dirname(process.execPath), ...system].join(":");
}

// The environment every demo process runs with, built from scratch rather
// than inherited, so no real session, tmux socket or config leaks in.
export function demoEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: demoPath(),
    HOME,
    USER,
    LOGNAME: USER,
    SHELL: demoShell(),
    LANG: "en_US.UTF-8",
    TERM: "xterm-256color",
    TMUX_TMPDIR,
    DB_PATH,
    AGENTOS_DEMO_ROOT: ROOT,
    PORT: String(PORT),
    GIT_CONFIG_NOSYSTEM: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "development",
    ...extra,
  };
}
