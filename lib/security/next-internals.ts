/**
 * Next's image optimizer (/_next/image) fetches the URL it is given from
 * this same server, internally, past server.ts: no auth gate, no demo gate.
 * AgentOS never uses next/image, so the endpoint is refused for everyone.
 */

import type { ServerResponse } from "http";
import path from "path";

const REFUSED = ["/_next/image"];

// The path as Next might route it: percent-decoded (repeatedly), slashes
// collapsed, dot segments resolved, case folded. Undecodable is refused.
function normalized(url: string | undefined): string | null {
  let p = (url ?? "/").split(/[?#]/)[0];
  for (let i = 0; i < 4; i++) {
    let next: string;
    try {
      next = decodeURIComponent(p);
    } catch {
      return null;
    }
    if (next === p) break;
    p = next;
  }
  return path.posix
    .normalize(p.replace(/\\/g, "/").replace(/\/+/g, "/"))
    .toLowerCase();
}

export function refusedNextInternal(url: string | undefined): boolean {
  const p = normalized(url);
  if (p === null) return true;
  return REFUSED.some((r) => p === r || p.startsWith(r + "/"));
}

/** Answers a refused request 404 and returns true; false lets it go on. */
export function refuseNextInternal(
  req: { url?: string },
  res: Pick<ServerResponse, "statusCode" | "end">
): boolean {
  if (!refusedNextInternal(req.url)) return false;
  res.statusCode = 404;
  res.end();
  return true;
}
