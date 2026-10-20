/**
 * The only routes a linked machine may call here, by method and pattern.
 * These are the calls the peer code makes today and nothing else. A path is
 * taken only in its plain form: no encoding, no dot segments, no doubled or
 * back slashes, so what is matched is exactly what the route sees. An id
 * segment is [A-Za-z0-9_.-]{1,128}, and each route names its query keys.
 */

type Method = "GET" | "POST" | "DELETE";

interface PeerRoute {
  method: Method;
  pattern: string;
  query?: readonly string[];
}

const each = (
  method: Method,
  base: string,
  tails: string[],
  query?: string[]
): PeerRoute[] =>
  tails.map((t) => ({
    method,
    pattern: `${base}/${t}`,
    ...(query && { query }),
  }));

export const PEER_ROUTES: readonly PeerRoute[] = [
  { method: "GET", pattern: "/api/tasks" },
  { method: "POST", pattern: "/api/tasks" },
  { method: "POST", pattern: "/api/tasks/import" },
  { method: "GET", pattern: "/api/tasks/arrived", query: ["from"] },
  { method: "GET", pattern: "/api/tasks/held-replies" },
  { method: "POST", pattern: "/api/tasks/held-replies" },
  ...each("POST", "/api/tasks/:id", [
    "export",
    "approve-plan",
    "hold",
    "message",
    "stop",
    "done",
    "drop",
    "resume",
    "moved",
    "merge",
  ]),
  ...each("GET", "/api/tasks/:id", ["plan", "chat-facts"]),
  { method: "GET", pattern: "/api/tasks/:id/chat-tail", query: ["lines"] },

  { method: "GET", pattern: "/api/sessions" },
  { method: "GET", pattern: "/api/sessions/status" },
  { method: "POST", pattern: "/api/sessions" },
  { method: "DELETE", pattern: "/api/sessions/:id" },
  ...each("POST", "/api/sessions/:id", ["done", "unarchive", "resurrect"]),
  ...each("GET", "/api/sessions/:id", ["preview", "artifacts", "setup"]),

  { method: "GET", pattern: "/api/projects" },
  { method: "POST", pattern: "/api/projects/availability" },
  { method: "GET", pattern: "/api/tmux/discover" },
  { method: "GET", pattern: "/api/load" },

  { method: "GET", pattern: "/api/worktree-sweep" },
  { method: "POST", pattern: "/api/worktree-sweep" },
  { method: "POST", pattern: "/api/worktree-sweep/run" },

  { method: "POST", pattern: "/api/peer/unlink" },
  { method: "GET", pattern: "/api/peer/ping" },

  // The work registry's exchange (not built yet: 404 until it is).
  { method: "POST", pattern: "/api/claims/exchange" },
];

const PLAIN_PATH = /^\/api(\/[A-Za-z0-9_.-]{1,128}){1,6}$/;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_QUERY = 4096;

export type RouteMatch =
  | { ok: true; route: string; path: string; query: string }
  | { ok: false; reason: "bad_path" | "bad_query" | "not_allowed" };

function segmentsMatch(pattern: string[], path: string[]): boolean {
  return (
    pattern.length === path.length &&
    pattern.every((p, i) => (p === ":id" ? ID.test(path[i]) : p === path[i]))
  );
}

function cleanQuery(
  raw: string,
  allowed: readonly string[] = []
): string | null {
  if (!raw) return "";
  if (raw.length > MAX_QUERY || /[#\u0000-\u001f\u007f]/.test(raw)) return null;
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return null;
  for (const [k, v] of params) {
    if (!allowed.includes(k) || v.length > 1024) return null;
    if (/[\u0000-\u001f\u007f]/.test(v)) return null;
  }
  return params.toString();
}

/** The route a peer's call matches, with its path and query as dispatched. */
export function matchPeerRoute(
  method: string,
  path: string,
  query = ""
): RouteMatch {
  if (typeof path !== "string" || !PLAIN_PATH.test(path))
    return { ok: false, reason: "bad_path" };
  const parts = path.split("/").slice(1);
  if (parts.some((p) => p === "." || p === ".."))
    return { ok: false, reason: "bad_path" };
  const route = PEER_ROUTES.find(
    (r) =>
      r.method === method && segmentsMatch(r.pattern.split("/").slice(1), parts)
  );
  if (!route) return { ok: false, reason: "not_allowed" };
  const clean = cleanQuery(query, route.query);
  if (clean === null) return { ok: false, reason: "bad_query" };
  return { ok: true, route: route.pattern, path, query: clean };
}

/** For the gate: a request target (path and query) a peer may reach. */
export function peerTargetAllowed(
  method: string | undefined,
  url: string | undefined
) {
  const target = url ?? "";
  const q = target.indexOf("?");
  const path = q < 0 ? target : target.slice(0, q);
  const query = q < 0 ? "" : target.slice(q + 1);
  return matchPeerRoute(method ?? "", path, query).ok;
}
