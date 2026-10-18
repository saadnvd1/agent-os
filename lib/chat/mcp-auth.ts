/**
 * Signing in to an MCP server from the browser. The agent starts the
 * sign-in and gives a link; the provider then sends the browser back to
 * AgentOS (/api/mcp-auth/callback), which hands that address to the agent.
 * What ties the return to the attempt is the OAuth `state`, kept in SQLite
 * (the start and callback routes are separate bundles, so memory isn't
 * shared), used once, and dropped after PENDING_MS. The agent holds the
 * tokens; nothing here stores or logs the address it was given.
 */

import { db } from "../db";
import { getItem } from "./store";
import { mcpAuthWorker } from "./runner";
import type { McpSignInStart } from "./events";

export const PENDING_MS = 15 * 60 * 1000;
export const CALLBACK_PATH = "/api/mcp-auth/callback";

interface Pending {
  sessionId: string;
  itemId: string;
  server: string;
  origin: string | null;
  at: number;
}

interface PendingRow {
  session_id: string;
  item_id: string;
  server: string;
  origin: string | null;
  at: number;
}

export function resetMcpSignIns(): void {
  db.prepare(`DELETE FROM mcp_sign_ins`).run();
}

function sweep(now = Date.now()): void {
  db.prepare(`DELETE FROM mcp_sign_ins WHERE at < ?`).run(now - PENDING_MS);
}

function savePending(state: string, p: Pending): void {
  db.prepare(
    `DELETE FROM mcp_sign_ins WHERE session_id = ? AND server = ?`
  ).run(p.sessionId, p.server);
  db.prepare(
    `INSERT OR REPLACE INTO mcp_sign_ins (state, session_id, item_id, server, origin, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(state, p.sessionId, p.itemId, p.server, p.origin, p.at);
}

function peekPending(state: string): Pending | undefined {
  const r = db
    .prepare(`SELECT * FROM mcp_sign_ins WHERE state = ?`)
    .get(state) as PendingRow | undefined;
  return (
    r && {
      sessionId: r.session_id,
      itemId: r.item_id,
      server: r.server,
      origin: r.origin,
      at: r.at,
    }
  );
}

// Single use: only the caller whose delete changed a row may go on.
function takePending(state: string): boolean {
  return (
    db.prepare(`DELETE FROM mcp_sign_ins WHERE state = ?`).run(state).changes >
    0
  );
}

// `http(s)://host[:port]`, nothing else: the browser's own address for
// AgentOS, so the provider returns to wherever the user is.
export function cleanOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin === value ? url.origin : null;
  } catch {
    return null;
  }
}

function serverOf(sessionId: string, itemId: string, server: string) {
  const item = getItem(sessionId, itemId);
  if (item?.kind !== "mcp") throw new Error("That list is gone");
  const view = item.servers.find((s) => s.name === server);
  if (!view) throw new Error(`${server} isn't in that list`);
  return view;
}

export async function startMcpSignIn(
  sessionId: string,
  input: { itemId: string; server: string; origin?: string | null }
): Promise<McpSignInStart> {
  if (!serverOf(sessionId, input.itemId, input.server).signIn)
    throw new Error("AgentOS can't sign in to this server");
  const worker = mcpAuthWorker(sessionId);
  const origin = cleanOrigin(input.origin);
  const { start, error } = await worker.mcpAuth(
    {
      action: "start",
      server: input.server,
      itemId: input.itemId,
      redirectUri: origin ? `${origin}${CALLBACK_PATH}` : undefined,
    },
    30_000
  );
  if (error || !start) throw new Error(error ?? "Sign-in didn't start");
  sweep();
  const { state, ...result } = start;
  if (state)
    savePending(state, {
      sessionId,
      itemId: input.itemId,
      server: input.server,
      origin,
      at: Date.now(),
    });
  return result;
}

// The provider returned the browser (or the user pasted the address it
// ended on). `expect` pins a pasted address to the row it was typed in.
export async function finishMcpSignIn(
  callbackUrl: string,
  expect?: { sessionId: string; server: string }
): Promise<{ server: string }> {
  sweep();
  let state: string | null = null;
  try {
    state = new URL(callbackUrl).searchParams.get("state");
  } catch {
    throw new Error("That isn't a web address");
  }
  const p = state ? peekPending(state) : undefined;
  if (!state || !p)
    throw new Error(
      "That sign-in expired or was already used. Press Sign in again."
    );
  if (
    expect &&
    (expect.sessionId !== p.sessionId || expect.server !== p.server)
  )
    throw new Error("That address belongs to a different sign-in");
  if (!takePending(state))
    throw new Error(
      "That sign-in expired or was already used. Press Sign in again."
    );
  const { error } = await mcpAuthWorker(p.sessionId).mcpAuth({
    action: "submit",
    server: p.server,
    itemId: p.itemId,
    url: callbackUrl,
  });
  if (error) throw new Error(error);
  return { server: p.server };
}

// The provider's redirect reached our callback route. Rebuild the address
// from the origin the sign-in started with, not from the request (behind the
// custom server Next may derive it from Host), so it matches the
// redirect_uri the provider was given exactly.
export async function finishMcpSignInFromRedirect(
  search: string
): Promise<{ server: string }> {
  sweep();
  const state = new URLSearchParams(search).get("state");
  const origin = state ? peekPending(state)?.origin : null;
  if (!origin)
    throw new Error(
      "That sign-in expired or was already used. Press Sign in again."
    );
  return finishMcpSignIn(`${origin}${CALLBACK_PATH}${search}`);
}

// "Check again": reconnect and refresh the list.
export async function reconnectMcpServer(
  sessionId: string,
  input: { itemId: string; server: string }
): Promise<void> {
  serverOf(sessionId, input.itemId, input.server);
  const { error } = await mcpAuthWorker(sessionId).mcpAuth(
    { action: "reconnect", ...input },
    30_000
  );
  if (error) throw new Error(error);
}
