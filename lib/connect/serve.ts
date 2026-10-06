/**
 * Serve AgentOS through Connect: streams from the tunnel carry TLS for
 * <id>.<machine domain>, which only this process can open. Requests then
 * go through the same handlers (and the same device check) as any other
 * listener. They are never "loopback": a TunnelStream has no address.
 */

import https from "https";
import type { IncomingMessage, ServerResponse } from "http";
import type { Duplex } from "stream";
import { loadConnect } from "./config";
import { startTunnel } from "./tunnel";

export interface Handlers {
  onRequest: (req: IncomingMessage, res: ServerResponse) => void;
  onUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

export function startConnect(handlers: Handlers, log = console.log) {
  const files = loadConnect();
  if (!files) return null;
  const server = https.createServer(files.tls, handlers.onRequest);
  server.on("upgrade", handlers.onUpgrade);
  const tunnel = startTunnel({
    config: files.config,
    machineKey: files.machineKey,
    onStream: (stream) => server.emit("connection", stream),
    log,
  });
  return { hostname: files.config.hostname, tunnel };
}
