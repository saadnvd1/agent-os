/**
 * Serve AgentOS through Connect: streams from the tunnel carry TLS for
 * <id>.<machine domain>, which only this process can open. Requests then go
 * through the same handlers and device check as any other listener; they
 * are never "this machine" (a TunnelStream has no address).
 *
 * Connect follows connect.json while running: `agent-os disconnect` or the
 * switch in Devices closes the tunnel and every open tunnel connection at
 * once. Nothing here may stop AgentOS from starting.
 */

import fs from "fs";
import https from "https";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import type { Duplex } from "stream";
import { connectDir, readConnect } from "./config";
import { shouldStartConnect, takeConnectLock } from "./guard";
import { startTunnel } from "./tunnel";
import { certStatus, type CertStatus } from "./cert-check";

export interface Handlers {
  onRequest: (req: IncomingMessage, res: ServerResponse) => void;
  onUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

export interface ConnectStatus {
  state: "off" | "refused" | "error" | "connecting" | "up" | "denied";
  hostname?: string;
  reason?: string;
  cert?: CertStatus;
}

interface Running {
  server: https.Server;
  tunnel: ReturnType<typeof startTunnel>;
  sockets: Set<Duplex>;
  hostname: string;
  release: () => void;
}

const g = globalThis as unknown as { __agentosConnect?: () => ConnectStatus };
export const connectStatus = (): ConnectStatus =>
  g.__agentosConnect?.() ?? { state: "off" };

const hostOf = (h?: string) => (h ?? "").toLowerCase().replace(/:\d+$/, "");

export function startConnect(
  handlers: Handlers,
  port: number,
  log = console.log
) {
  const dir = connectDir();
  const decision = shouldStartConnect(process.env, port);
  let base: ConnectStatus = { state: "off" };
  let running: Running | null = null;
  g.__agentosConnect = () =>
    running
      ? { ...base, state: running.tunnel.state() as ConnectStatus["state"] }
      : base;

  if (!decision.start) {
    if (readConnect(dir).ok) log(`connect: not starting: ${decision.reason}`);
    base = { state: "refused", reason: decision.reason };
    return { hostname: () => null as string | null };
  }

  // Only the machine's own name: anything else through the tunnel is refused.
  const pinned = (hostname: string): Handlers => ({
    onRequest: (req, res) => {
      if (hostOf(req.headers.host) !== hostname) {
        res.statusCode = 421;
        return res.end();
      }
      handlers.onRequest(req, res);
    },
    onUpgrade: (req, socket, head) => {
      if (hostOf(req.headers.host) !== hostname) return socket.destroy();
      handlers.onUpgrade(req, socket, head);
    },
  });

  const down = (why: string) => {
    if (!running) return;
    running.tunnel.stop();
    running.sockets.forEach((s) => s.destroy());
    running.server.close();
    running.release();
    log(`connect: off (${why})`);
    running = null;
  };

  const up = () => {
    const read = readConnect(dir);
    if (!read.ok) {
      base = {
        state: read.reason === "not enrolled" ? "off" : "error",
        reason: read.reason,
      };
      if (read.reason !== "not enrolled") log(`connect: ${read.reason}`);
      return;
    }
    const { files } = read;
    base = {
      state: "off",
      hostname: files.config.hostname,
      cert: certStatus(files.tls.cert),
    };
    if (!read.enabled) return;
    const lock = takeConnectLock(dir);
    if ("heldBy" in lock) {
      base = {
        ...base,
        state: "refused",
        reason: `another AgentOS (pid ${lock.heldBy}) holds the tunnel`,
      };
      log(`connect: ${base.reason}`);
      return;
    }
    try {
      const h = pinned(files.config.hostname);
      const server = https.createServer(files.tls, h.onRequest);
      server.on("upgrade", h.onUpgrade);
      const sockets = new Set<Duplex>();
      const tunnel = startTunnel({
        config: files.config,
        machineKey: files.machineKey,
        onStream: (stream) => {
          sockets.add(stream);
          stream.once("close", () => sockets.delete(stream));
          server.emit("connection", stream);
        },
        log,
      });
      running = {
        server,
        tunnel,
        sockets,
        hostname: files.config.hostname,
        release: lock.release,
      };
    } catch (err) {
      lock.release();
      base = { ...base, state: "error", reason: (err as Error).message };
      log(`connect: could not start: ${(err as Error).message}`);
    }
  };

  const sync = () => {
    const read = readConnect(dir);
    const want = read.ok && read.enabled;
    if (running && !want) down(read.ok ? "turned off" : read.reason);
    else if (!running && want) up();
    else if (running && read.ok) {
      base.cert = certStatus(read.files.tls.cert);
      running.server.setSecureContext(read.files.tls); // a renewed certificate
    } else if (!running) up();
  };

  up();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const f of ["connect.json", "tls.crt"])
    fs.watchFile(path.join(dir, f), { interval: 2000 }, sync);
  setInterval(sync, 24 * 60 * 60 * 1000).unref();
  const stop = () => down("shutting down");
  process.once("exit", stop);
  return { hostname: () => base.hostname ?? running?.hostname ?? null };
}
