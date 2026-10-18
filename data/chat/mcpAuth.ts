import { useMutation } from "@tanstack/react-query";
import type { McpSignInStart } from "@/lib/chat/events";

type Body = {
  action: "start" | "submit" | "reconnect";
  server: string;
  itemId: string;
  url?: string;
};

async function post<T>(sessionId: string, body: Body): Promise<T> {
  const res = await fetch(`/api/sessions/${sessionId}/mcp-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

// Sign in to one MCP server of a chat's /mcp list. The list itself updates
// over the chat socket once the server is back.
export function useMcpSignIn(
  sessionId: string,
  itemId: string,
  server: string
) {
  const start = useMutation({
    mutationFn: () =>
      post<McpSignInStart>(sessionId, { action: "start", server, itemId }),
  });
  const finish = useMutation({
    mutationFn: (url: string) =>
      post<{ ok: true }>(sessionId, { action: "submit", server, itemId, url }),
  });
  const recheck = useMutation({
    mutationFn: () =>
      post<{ ok: true }>(sessionId, { action: "reconnect", server, itemId }),
  });
  return { start, finish, recheck };
}
