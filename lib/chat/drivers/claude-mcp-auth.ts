import type { McpServerStatus, Query } from "@anthropic-ai/claude-agent-sdk";
import type { McpAuth } from "../driver";
import type { McpServerView, McpSignInStart } from "../events";

// The CLI takes these as control requests and the SDK's Query has the
// methods, but its type declarations don't list them.
type AuthQuery = Query & {
  mcpAuthenticate?(server: string, redirectUri?: string): Promise<unknown>;
  mcpSubmitOAuthCallbackUrl?(server: string, url: string): Promise<unknown>;
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Only a link a person can safely open: https, or http to this machine.
export function safeAuthUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return url.href;
  } catch {
    // Not a URL.
  }
  return null;
}

// The CLI's answer to mcp_authenticate, as what the UI needs.
export function toSignInStart(
  response: unknown
): McpSignInStart & { state?: string } {
  const r = (response ?? {}) as {
    authUrl?: unknown;
    requiresUserAction?: unknown;
    callbackExpected?: unknown;
    redirectScheme?: unknown;
    state?: unknown;
  };
  if (!r.requiresUserAction && r.authUrl === undefined) return { mode: "done" };
  const authUrl = safeAuthUrl(r.authUrl);
  if (!authUrl)
    throw new Error("The server gave a sign-in link AgentOS won't open");
  if (!r.callbackExpected) return { mode: "external", authUrl };
  const state = typeof r.state === "string" ? r.state : undefined;
  return r.redirectScheme === "custom"
    ? { mode: "callback", authUrl, state }
    : { mode: "paste", authUrl, state };
}

// Whether a server can be signed in to: it speaks OAuth over HTTP.
export function canSignIn(s: McpServerStatus): boolean {
  if (s.status !== "needs-auth") return false;
  const c = s.config as { type?: string; command?: unknown } | undefined;
  if (!c) return true;
  return c.type === "http" || c.type === "sse" || c.type === "claudeai-proxy";
}

export function claudeMcpAuth(
  q: Query,
  view: (s: McpServerStatus) => McpServerView
): McpAuth {
  const auth = q as AuthQuery;
  return {
    async start(server, redirectUri) {
      if (!auth.mcpAuthenticate)
        throw new Error(
          "This Claude Code version can't sign in to MCP servers from AgentOS"
        );
      return toSignInStart(await auth.mcpAuthenticate(server, redirectUri));
    },
    async submit(server, callbackUrl) {
      if (!auth.mcpSubmitOAuthCallbackUrl)
        throw new Error(
          "This Claude Code version can't sign in to MCP servers from AgentOS"
        );
      await auth.mcpSubmitOAuthCallbackUrl(server, callbackUrl);
    },
    reconnect: (server) => q.reconnectMcpServer(server),
    async servers() {
      return (await q.mcpServerStatus()).map(view);
    },
  };
}
