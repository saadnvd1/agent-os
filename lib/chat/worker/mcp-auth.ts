/**
 * Signing in to an MCP server from a chat: the worker owns the agent, so it
 * starts the sign-in, hands over the address the provider returned to, and
 * reconnects. The /mcp item it came from is rewritten in place (same id) so
 * its row turns connected. A sign-in the browser can't finish by itself (it
 * happens on another machine, or on claude.ai) is watched until the server
 * stops needing it.
 */

import type { ChatConversation, McpAuth } from "../driver";
import type { ChatItem, McpSignInStart } from "../events";
import { cleanMcpError } from "../drivers/claude";
import type { WorkerCommand, WorkerEvent } from "./protocol";

export type McpAuthCommand = Extract<WorkerCommand, { type: "mcp_auth" }>;

export const WATCH_EVERY_MS = 2000;
export const WATCH_FOR_MS = 10 * 60 * 1000;

interface Host {
  emit(e: WorkerEvent): void;
  record(item: ChatItem): void;
  item(id: string): ChatItem | undefined;
}

const watches = new WeakMap<object, Map<string, NodeJS.Timeout>>();

function stopWatch(owner: object, server: string): void {
  const timer = watches.get(owner)?.get(server);
  if (timer) clearInterval(timer);
  watches.get(owner)?.delete(server);
}

// The conversation is closing: no watch outlives it.
export function stopMcpWatches(auth: object | undefined): void {
  if (!auth) return;
  for (const timer of watches.get(auth)?.values() ?? []) clearInterval(timer);
  watches.delete(auth);
}

// Rewrites the /mcp item with the servers as they are now.
async function refresh(auth: McpAuth, host: Host, itemId: string) {
  const item = host.item(itemId);
  if (item?.kind !== "mcp") return;
  host.record({ ...item, servers: await auth.servers() });
}

function watch(auth: McpAuth, host: Host, itemId: string, server: string) {
  const owner = auth;
  stopWatch(owner, server);
  const timers = watches.get(owner) ?? new Map();
  watches.set(owner, timers);
  const started = Date.now();
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const now = (await auth.servers()).find((s) => s.name === server);
      if (now && now.status !== "needs-auth") {
        stopWatch(owner, server);
        await refresh(auth, host, itemId);
      } else if (Date.now() - started > WATCH_FOR_MS) stopWatch(owner, server);
    } catch {
      stopWatch(owner, server);
    } finally {
      busy = false;
    }
  }, WATCH_EVERY_MS);
  timer.unref?.();
  timers.set(server, timer);
}

export async function handleMcpAuth(
  cmd: McpAuthCommand,
  conversation: Pick<ChatConversation, "mcpAuth">,
  host: Host
): Promise<void> {
  const auth = conversation.mcpAuth;
  const reply = (r: { start?: McpSignInStart; error?: string }) =>
    host.emit({ type: "mcp_auth_result", reqId: cmd.reqId, ...r });
  if (!auth) return reply({ error: "This agent can't sign in to MCP servers" });
  try {
    if (cmd.action === "start") {
      const { state, ...start } = await auth.start(cmd.server, cmd.redirectUri);
      if (start.mode === "done") {
        await auth.reconnect(cmd.server);
        await refresh(auth, host, cmd.itemId);
      } else if (start.mode !== "callback")
        watch(auth, host, cmd.itemId, cmd.server);
      // The state ties the provider's return to this attempt; the server
      // keeps it, the browser never needs it.
      return reply({ start: { ...start, ...(state && { state }) } });
    }
    stopWatch(auth, cmd.server);
    let failure: unknown;
    try {
      if (cmd.action === "submit") {
        if (!cmd.url) throw new Error("No address to finish with");
        await auth.submit(cmd.server, cmd.url);
      }
      await auth.reconnect(cmd.server);
    } catch (error) {
      failure = error;
    }
    await refresh(auth, host, cmd.itemId).catch(() => {});
    reply(failure ? { error: message(failure) } : {});
  } catch (error) {
    reply({ error: message(error) });
  }
}

// An error can quote the server's URL, and a key in it.
function message(error: unknown): string {
  return (
    cleanMcpError(error instanceof Error ? error.message : String(error)) ??
    "Sign-in failed"
  );
}
