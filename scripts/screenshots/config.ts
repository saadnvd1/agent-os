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

// The environment every demo process runs with, built from scratch rather
// than inherited, so no real session, tmux socket or config leaks in.
export function demoEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const nodeBin = path.dirname(process.execPath);
  return {
    PATH: [BIN, nodeBin, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
      .concat(["/bin", "/usr/sbin", "/sbin"])
      .join(":"),
    HOME,
    USER,
    LOGNAME: USER,
    SHELL: "/bin/zsh",
    LANG: "en_US.UTF-8",
    TERM: "xterm-256color",
    TMUX_TMPDIR,
    DB_PATH,
    PORT: String(PORT),
    GIT_CONFIG_NOSYSTEM: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "development",
    ...extra,
  };
}
