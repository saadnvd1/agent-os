/**
 * Demo mode (AGENTOS_DEMO=1): a server safe to show to strangers, over
 * seeded data. Fail closed: a request is refused unless it is on the read
 * allowlist below. Nothing that runs code or changes the machine is on it:
 * terminals, exec, send-keys, git and tmux writes, file writes, starting
 * sessions, tasks, dev servers, remote hosts. Chat sends get a canned reply
 * (lib/demo/chat) instead of an agent.
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import type { Duplex } from "stream";

type Env = Record<string, string | undefined>;

export const demoMode = (env: Env = process.env) => env.AGENTOS_DEMO === "1";

const within = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * A demo serves a throwaway world, never the machine's own: its home and
 * database must both live under AGENTOS_DEMO_ROOT (scripts/screenshots
 * builds one). Throws otherwise, so a stray AGENTOS_DEMO=1 can't publish
 * someone's real sessions and files.
 */
export function assertDemoSandbox(env: Env = process.env, home = os.homedir()) {
  const root = env.AGENTOS_DEMO_ROOT && path.resolve(env.AGENTOS_DEMO_ROOT);
  const db = env.DB_PATH && path.resolve(env.DB_PATH);
  if (!root || root === path.parse(root).root)
    throw new Error("AGENTOS_DEMO=1 needs AGENTOS_DEMO_ROOT, the demo's root");
  if (!db || !within(db, root) || !within(path.resolve(home), root))
    throw new Error(
      "AGENTOS_DEMO=1 needs HOME and DB_PATH inside AGENTOS_DEMO_ROOT"
    );
}

// Route folders that sit next to a dynamic one ("projects/browse" beside
// "projects/[id]"): Next serves the folder, so an id must never match them.
// The test walks app/api and fails when one is missing here.
export const STATIC_SIBLINGS = [
  "archived",
  "arrived",
  "browse",
  "clone",
  "detect",
  "done-idle",
  "import",
  "init",
  "init-script",
  "items",
  "network",
  "status",
];
// No leading "-": an id that reaches a command line can't read as an option.
const ID = `(?!(?:${STATIC_SIBLINGS.join("|")})(?:/|$))[A-Za-z0-9_][A-Za-z0-9._-]*`;
const route = (p: string) => new RegExp(`^/api/${p.replace(/\[id\]/g, ID)}$`);

// Reads the UI makes over seeded data. Every entry was checked to start no
// agent, shell or dev server, and to write nothing but caches.
const READS = [
  "sessions",
  "sessions/status",
  "sessions/archived",
  "sessions/[id]",
  "sessions/[id]/messages",
  "sessions/[id]/pr",
  "sessions/[id]/artifacts",
  "sessions/[id]/setup",
  "sessions/[id]/preview",
  "projects",
  "projects/[id]",
  "projects/[id]/repositories",
  "workspaces",
  "groups",
  "groups/.+",
  "tasks",
  "tasks/arrived",
  "stacks",
  "stacks/[id]",
  "schedules",
  "schedules/[id]",
  "orchestrators",
  "orchestrate/workers",
  "orchestrate/workers/[id]",
  "bus/messages",
  "bus/peers",
  "usage",
  "vendor/mermaid",
  "artifacts/[id]",
  "git/status",
  "git/file-content",
  "git/history",
  "git/history/[id]",
  "git/history/[id]/diff",
  "git/multi-status",
  "git/pr",
  "dev-servers",
  "code-search/available",
  "code-search",
  "files",
  "files/content",
  "files/image",
  "pair/status",
].map(route);

// The only writes: pairing a device (start is loopback-only in its route),
// and marking a session seen, which is the reader's own bookkeeping.
const WRITES = ["pair/start", "pair/claim", "sessions/[id]/seen"].map(route);

// Query parameters that name a place on disk: they must stay in the demo's
// home. One that names another machine must name this one.
// Query parameters that name a place on disk must name one in the demo's
// home: absolute or "~/...", plain characters only (some routes still build
// shell strings), and inside the home once symlinks are followed. `file` is
// relative to the folder in `path`, and checked the same way.
const DIR_PARAMS = ["path", "fallbackPath", "dir", "cwd"];
const PLAIN = /^[A-Za-z0-9._~/@+-]+$/;
const REFUSED_PARAMS: Record<string, (v: string) => boolean> = {
  hostId: (v) => v !== "local",
  // Asks an agent to write the PR description.
  generate: (v) => v === "true",
};

function real(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function plain(value: string): boolean {
  return (
    PLAIN.test(value) &&
    !value.startsWith("-") &&
    !value.split("/").includes("..")
  );
}

function homeDir(value: string, home: string): string | null {
  if (
    !plain(value) ||
    !(value === "~" || value.startsWith("~/") || value.startsWith("/"))
  )
    return null;
  const resolved = real(value.replace(/^~/, home));
  return within(resolved, real(home)) ? resolved : null;
}

/** A folder a visitor names (a status socket's git watch) in the home. */
export const demoDirAllowed = (value: string, home = os.homedir()) =>
  !!homeDir(value, home);

function paramsAllowed(params: URLSearchParams, home: string): boolean {
  for (const [key, value] of params) {
    if (DIR_PARAMS.includes(key) && !homeDir(value, home)) return false;
    if (REFUSED_PARAMS[key]?.(value)) return false;
  }
  const file = params.get("file");
  if (file === null) return true;
  if (!plain(file)) return false;
  if (file.startsWith("/")) return !!homeDir(file, home);
  const dir = params.get("path");
  const base = dir ? homeDir(dir, home) : null;
  return !!base && within(real(path.join(base, file)), real(home));
}

export interface DemoRequest {
  method?: string;
  url?: string;
}

/** Whether demo mode lets this HTTP request through. */
export function demoAllows(req: DemoRequest, home = os.homedir()): boolean {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://demo");
  } catch {
    return false;
  }
  const p = url.pathname;
  if (p.includes("..") || p.includes("//")) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const read = method === "GET" || method === "HEAD";
  // Next's own endpoints beyond its static files (the image optimizer
  // among them) can reach the API from inside, past this gate.
  if (/^\/_{1,2}next/i.test(p) && !p.startsWith("/_next/static/")) return false;
  if (!p.startsWith("/api/")) return read;
  if (!paramsAllowed(url.searchParams, home)) return false;
  if (read) return READS.some((r) => r.test(p));
  return method === "POST" && WRITES.some((r) => r.test(p));
}

// The sockets a demo serves: chat (with the stub driver) and status. Never a
// terminal. Next's dev reloader only in development (refused, the page
// reloads itself in a loop).
const DEV_SOCKETS = ["/_next/hmr", "/_next/webpack-hmr"];
export function demoAllowsUpgrade(
  pathname: string | null,
  dev = process.env.NODE_ENV !== "production"
): boolean {
  if (pathname === "/ws/chat" || pathname === "/ws/status") return true;
  return dev && DEV_SOCKETS.includes(pathname ?? "");
}

const REFUSAL = "Not available in the demo.";

/** Returns true when the request may go on; answers 403 otherwise. */
export function gateDemoRequest(
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  if (demoAllows(req)) return true;
  res.statusCode = 403;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: REFUSAL }));
  return false;
}

export function refuseDemoUpgrade(socket: Duplex): void {
  socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
  socket.destroy();
}

export const DEMO_REFUSAL = REFUSAL;
