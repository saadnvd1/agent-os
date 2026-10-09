/**
 * Demo mode (AGENTOS_DEMO=1): a server safe to show to strangers, over
 * seeded data. Fail closed: a request is refused unless it is on the read
 * allowlist below. Nothing that runs code or changes the machine is on it:
 * terminals, exec, send-keys, git and tmux writes, file writes, starting
 * sessions, tasks, dev servers, remote hosts. Chat sends get a canned reply
 * (lib/demo/chat) instead of an agent.
 */

import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "http";
import { plainAddress, proxied } from "./auth";
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
  // Who this request is (devices without their addresses) and a network
  // stub: what a client checks before it trusts the server.
  "devices",
  "devices/network",
].map(route);

// The only writes, each a database write and nothing more in demo mode:
// pairing a device (start is loopback-only in its route), marking a session
// seen or pinned, done (archives only: no merge, no clean-up), answering an
// ask, and removing the caller's own device.
const WRITES: [string, RegExp][] = [
  ["POST", "pair/start"],
  ["POST", "pair/claim"],
  ["POST", "sessions/[id]/seen"],
  ["POST", "sessions/[id]/pin"],
  ["POST", "sessions/[id]/done"],
  ["POST", "workspaces/[id]/orchestrator/asks/[id]"],
  ["DELETE", "devices/[id]"],
].map(([m, p]) => [m, route(p)]);

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
  return WRITES.some(([m, r]) => m === method && r.test(p));
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

// Status sockets are cheap for a visitor to open and each one costs the
// server a subscription and git watches, so a demo caps them: a few per
// client address, and a ceiling for everyone. Behind a reverse proxy every
// visitor shares the proxy's address, so a proxied socket (client null)
// counts only toward the total.
export const DEMO_SOCKETS_PER_CLIENT = 4;
export const DEMO_SOCKETS_TOTAL = 200;
// WebSocket close code 1013, "try again later".
export const DEMO_BUSY_CODE = 1013;
export const DEMO_BUSY_REASON = "Too many connections to the demo";

function ipv6Prefix(ip: string): string {
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") && tail ? tail.split(":") : [];
  const groups = [
    ...left,
    ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"),
    ...right,
  ];
  return groups
    .slice(0, 4)
    .map((g) => parseInt(g || "0", 16).toString(16))
    .join(":");
}

/**
 * Whose socket this is, for the per-client cap. Null when the address
 * stands for many visitors (a proxy, loopback, a Connect stream): those
 * count only toward the total. One IPv6 host holds a whole /64, so that is
 * the client.
 */
export function demoClientKey(
  remote: string | undefined,
  headers: IncomingHttpHeaders
): string | null {
  const ip = plainAddress(remote);
  if (!ip || ip === "127.0.0.1" || ip === "::1") return null;
  // Forwarding headers count only from a peer that could be the demo's own
  // proxy (another container, the same network): from anyone else they are
  // the visitor's own say-so, and would lift their cap.
  if (proxied(headers) && privateAddress(ip)) return null;
  if (net.isIPv6(ip)) return `${ipv6Prefix(ip)}::/64`;
  return ip;
}

// Loopback, private, link-local and shared (CGNAT) ranges.
const PRIVATE = new net.BlockList();
PRIVATE.addSubnet("127.0.0.0", 8);
PRIVATE.addSubnet("10.0.0.0", 8);
PRIVATE.addSubnet("172.16.0.0", 12);
PRIVATE.addSubnet("192.168.0.0", 16);
PRIVATE.addSubnet("169.254.0.0", 16);
PRIVATE.addSubnet("100.64.0.0", 10);
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6");

function privateAddress(ip: string): boolean {
  const family = net.isIPv6(ip) ? "ipv6" : net.isIPv4(ip) ? "ipv4" : null;
  return !!family && PRIVATE.check(ip.split("%")[0], family);
}

/** Counts open sockets; `acquire` gives a release, or null when full. */
export function socketLimiter(
  perClient = DEMO_SOCKETS_PER_CLIENT,
  total = DEMO_SOCKETS_TOTAL
) {
  const open = new Map<string, number>();
  let all = 0;
  return {
    acquire(client: string | null): (() => void) | null {
      const mine = client === null ? 0 : (open.get(client) ?? 0);
      if (mine >= perClient || all >= total) return null;
      if (client !== null) open.set(client, mine + 1);
      all++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        all--;
        if (client === null) return;
        const left = (open.get(client) ?? 1) - 1;
        if (left > 0) open.set(client, left);
        else open.delete(client);
      };
    },
    count: (client?: string) =>
      client === undefined ? all : (open.get(client) ?? 0),
  };
}

interface DemoSocket {
  close(code: number, reason: string): void;
  terminate(): void;
  once(event: "close" | "error", fn: () => void): unknown;
}

/**
 * Takes a slot for a socket that just connected, freed when it closes.
 * When there is none, closes it with 1013, and drops it a second later if
 * the peer never answers the close.
 */
export function admitDemoSocket(
  ws: DemoSocket,
  request: Pick<IncomingMessage, "headers" | "socket">,
  slots: ReturnType<typeof socketLimiter>,
  dropAfterMs = 1000
): boolean {
  const release = slots.acquire(
    demoClientKey(request.socket.remoteAddress, request.headers)
  );
  if (release) {
    ws.once("close", release);
    return true;
  }
  // Nothing else listens on a refused socket: a bad frame in the second it
  // stays open would otherwise be an uncaught error.
  ws.once("error", () => ws.terminate());
  ws.close(DEMO_BUSY_CODE, DEMO_BUSY_REASON);
  setTimeout(() => ws.terminate(), dropAfterMs).unref();
  return false;
}
