import { createServer, type IncomingMessage } from "http";
import type { AddressInfo } from "net";
import { WebSocketServer, type WebSocket } from "ws";
import { authorize } from "../security/auth";

/**
 * Another machine's AgentOS, for tests: a real HTTP server that refuses an
 * upgrade the way AgentOS's gate does (the real authorize(), from an
 * address it doesn't trust, so only the device token can let it in), then
 * hands each socket to the test.
 */
export async function fakePeer(token: string) {
  const upgrades: { url: string; authorization?: string; origin?: string }[] =
    [];
  const sockets: { ws: WebSocket; url: URL; got: Record<string, unknown>[] }[] =
    [];
  let onSocket: (s: (typeof sockets)[number]) => void = () => {};
  const wss = new WebSocketServer({ noServer: true });
  // JSON answers by path, for HTTP calls; 404 otherwise.
  const routes: Record<string, () => unknown> = {};
  const allowed = (req: IncomingMessage) =>
    authorize(
      {
        url: req.url,
        headers: req.headers,
        remoteAddress: "203.0.113.9",
        localAddress: "203.0.113.1",
      },
      { tailnet: [], lookup: (t) => (t === token ? { id: "mac" } : null) }
    ).ok;
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const route = routes[path];
    res.setHeader("Content-Type", "application/json");
    if (!allowed(req)) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: "pairing required" }));
    }
    if (!route) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: "not found" }));
    }
    res.end(JSON.stringify(route()));
  });
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    upgrades.push({
      url: req.url ?? "",
      authorization: req.headers.authorization,
      origin: req.headers.origin,
    });
    if (!allowed(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const entry = {
        ws,
        url: new URL(req.url ?? "/", "http://x"),
        got: [] as Record<string, unknown>[],
      };
      ws.on("message", (raw) => entry.got.push(JSON.parse(raw.toString())));
      sockets.push(entry);
      onSocket(entry);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    upgrades,
    sockets,
    routes,
    onSocket: (fn: typeof onSocket) => void (onSocket = fn),
    close: () =>
      new Promise<void>((r) => {
        for (const c of wss.clients) c.terminate();
        server.close(() => r());
      }),
  };
}

export async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}
