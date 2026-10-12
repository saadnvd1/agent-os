/**
 * Serve AgentOS through Connect. Cloudflare's edge ends TLS for
 * m-<16 hex>.runagentos.com and cloudflared delivers each request to a
 * listener of its own on 127.0.0.1:<tunnel port>. That listener:
 *
 *   - marks every socket it accepts, so the gate never treats it as this
 *     machine, the tailnet or AGENTOS_AUTH=off: a paired device or nothing;
 *   - takes only the machine's own Host (cloudflared pins it) and strips
 *     X-Forwarded-Host, Forwarded and X-Original-Host before any handler.
 *
 * cloudflared starts only once that listener is bound and a connection to
 * the port is seen to arrive on it, and stops if the listener goes: it must
 * never publish whatever else holds the port.
 *
 * Connect follows connect.json while running: `agent-os disconnect` or the
 * switch in Devices stops cloudflared and closes every tunnel connection at
 * once. Nothing here may stop AgentOS from starting.
 */

import fs from "fs";
import http from "http";
import net from "net";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import type { Socket } from "net";
import type { Duplex } from "stream";
import { markTunnelSocket } from "@/lib/security/auth";
import {
  connectDir,
  connectTunnelPort,
  readConnect,
  saveConnect,
  type ConnectConfig,
} from "./config";
import { shouldStartConnect, takeConnectLock } from "./guard";
import {
  checkApiUrl,
  heartbeat as sendHeartbeat,
  requestTunnel,
  type Tunnel,
} from "./control-api";
import { appVersion, startHeartbeat } from "./heartbeat";
import { ensureCloudflared } from "./cloudflared";
import {
  reapTunnel,
  superviseTunnel,
  type ReapDeps,
  type Spawn,
  type TunnelState,
} from "./supervise";

export interface Handlers {
  onRequest: (req: IncomingMessage, res: ServerResponse) => void;
  onUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

export interface ConnectStatus {
  state: "off" | "refused" | "error" | "connecting" | "up" | "denied";
  /** Linked to the Connect service (it may not have a name yet). */
  enrolled?: boolean;
  hostname?: string;
  reason?: string;
}

const g = globalThis as unknown as { __agentosConnect?: () => ConnectStatus };
export const connectStatus = (): ConnectStatus =>
  g.__agentosConnect?.() ?? { state: "off" };

// Headers that would let a caller name a different host to Next or to us.
const HOST_OVERRIDES = ["x-forwarded-host", "forwarded", "x-original-host"];

/**
 * The listener cloudflared talks to. `hostname()` is the only Host it
 * serves; until the service has named the machine, nothing is served.
 */
export function tunnelListener(
  hostname: () => string,
  handlers: Handlers
): http.Server {
  const pinned = (req: IncomingMessage) => {
    for (const h of HOST_OVERRIDES) delete req.headers[h];
    const want = hostname();
    return !!want && (req.headers.host ?? "").toLowerCase() === want;
  };
  const server = http.createServer((req, res) => {
    if (!pinned(req)) {
      res.statusCode = 421;
      return res.end();
    }
    handlers.onRequest(req, res);
  });
  server.on("connection", (s: Socket) => markTunnelSocket(s));
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!pinned(req)) {
      socket.write("HTTP/1.1 421 Misdirected Request\r\n\r\n");
      return socket.destroy();
    }
    handlers.onUpgrade(req, socket, head);
  });
  server.on("clientError", (_err, socket) => socket.destroy());
  return server;
}

export interface ConnectDeps {
  ensureBinary?: (dir: string) => Promise<string>;
  requestTunnel?: (
    config: ConnectConfig,
    privateKey: string,
    port: number
  ) => Promise<Tunnel>;
  spawn?: Spawn;
  delays?: Parameters<typeof superviseTunnel>[0]["delays"];
  heartbeat?: typeof sendHeartbeat;
  heartbeatMs?: number;
  reap?: ReapDeps;
}

/**
 * Whether connections to 127.0.0.1:<port> reach `server`: one is made and
 * must show up on it. Never rejects.
 */
export function listenerIsOurs(
  server: http.Server,
  port: number,
  timeoutMs = 3000
): Promise<boolean> {
  return new Promise((resolve) => {
    const arrived = new Set<number>();
    let probePort: number | undefined;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.removeListener("connection", onConnection);
      client.destroy();
      resolve(ok);
    };
    const onConnection = (s: Socket) => {
      if (s.remotePort === undefined) return;
      arrived.add(s.remotePort);
      if (s.remotePort === probePort) finish(true);
    };
    server.prependListener("connection", onConnection);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    const client = net.connect(port, "127.0.0.1", () => {
      probePort = client.localPort;
      // The server may have seen it before this callback ran.
      if (probePort !== undefined && arrived.has(probePort)) finish(true);
    });
    client.on("error", () => finish(false));
  });
}

interface Running {
  server: http.Server;
  sockets: Set<Socket>;
  supervisor: ReturnType<typeof superviseTunnel> | null;
  heartbeat: ReturnType<typeof startHeartbeat>;
  release: () => void;
}

export function startConnect(
  handlers: Handlers,
  port: number,
  log = console.log,
  deps: ConnectDeps = {},
  env: NodeJS.ProcessEnv = process.env
) {
  const dir = connectDir();
  const decision = shouldStartConnect(env, port);
  const tunnelPort = connectTunnelPort(port, env);
  let base: ConnectStatus = { state: "off" };
  let hostname = "";
  let running: Running | null = null;
  // Set when the service disabled or dropped this machine; sync() leaves it
  // off until connect.json is turned off or relinked.
  let halted: string | null = null;
  // Set while the tunnel listener can't bind; it keeps trying.
  let bindError: string | undefined;
  g.__agentosConnect = () => {
    if (!running) return base;
    const s: TunnelState = running.supervisor?.state() ?? "connecting";
    return {
      ...base,
      hostname: hostname || base.hostname,
      state: bindError ? "error" : s === "stopped" ? "off" : s,
      reason: bindError ?? running.supervisor?.reason(),
    };
  };

  if (!decision.start || !tunnelPort) {
    const reason = decision.start
      ? "AGENTOS_CONNECT_PORT isn't a usable port"
      : decision.reason;
    if (readConnect(dir).ok) log(`connect: not starting: ${reason}`);
    base = { state: "refused", reason };
    return { hostname: () => null as string | null, close: () => {} };
  }

  const down = (why: string) => {
    if (!running) return;
    bindError = undefined;
    running.heartbeat.stop();
    running.supervisor?.stop();
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
    const { config, machineKey } = read.files;
    hostname = config.hostname;
    base = { state: "off", enrolled: true, hostname: hostname || undefined };
    if (!read.enabled) return;
    if (halted) {
      base = {
        ...base,
        state: "off",
        reason: "stopped by the Connect service",
      };
      return;
    }
    try {
      checkApiUrl(config.apiUrl, env.AGENTOS_CONNECT_OPERATOR === "1");
    } catch (err) {
      base = { ...base, state: "error", reason: (err as Error).message };
      log(`connect: ${base.reason}`);
      return;
    }
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
    // The lock is ours, so a cloudflared in the pid file belongs to an
    // AgentOS that died: it goes before anything else happens.
    const reaped = reapTunnel(dir, undefined, deps.reap).catch(() => false);
    const server = tunnelListener(() => hostname, handlers);
    const sockets = new Set<Socket>();
    server.on("connection", (s: Socket) => {
      sockets.add(s);
      s.once("close", () => sockets.delete(s));
    });
    const ensure =
      deps.ensureBinary ?? ((d: string) => ensureCloudflared({ dir: d }));
    const ask = deps.requestTunnel ?? requestTunnel;
    const startTunnel = () =>
      superviseTunnel({
        dir,
        log,
        spawn: deps.spawn,
        delays: deps.delays,
        prepare: async () => {
          const bin = await ensure(dir);
          // Fresh every start; the token lives only in this call and the child's env.
          const tunnel = await ask(config, machineKey, tunnelPort);
          if (tunnel.hostname !== hostname) {
            hostname = tunnel.hostname;
            saveConnect({ ...config, hostname }, dir);
            log(`connect: reachable at https://${hostname}`);
          }
          return { bin, token: tunnel.token };
        },
      });
    const stopTunnel = () => {
      if (running?.server !== server || !running.supervisor) return;
      running.supervisor.stop();
      running.supervisor = null;
    };
    // Something else may hold the port for a while (an AgentOS shutting
    // down, say): keep trying with backoff rather than giving up, with
    // cloudflared stopped meanwhile.
    const bindDelays = deps.delays ?? { min: 1000, max: 60_000 };
    let bindDelay = bindDelays.min;
    const rebind = (why: string) => {
      if (running?.server !== server) return;
      stopTunnel();
      bindError = `can't listen on 127.0.0.1:${tunnelPort}: ${why}`;
      log(`connect: ${bindError}; trying again`);
      const t = setTimeout(() => {
        if (running?.server !== server) return;
        server.close();
        server.listen(tunnelPort, "127.0.0.1");
      }, bindDelay);
      t.unref?.();
      bindDelay = Math.min(bindDelay * 2, bindDelays.max);
    };
    server.on("error", (err) => rebind(err.message));
    server.on("close", () => stopTunnel());
    server.on("listening", async () => {
      const [ours] = await Promise.all([
        listenerIsOurs(server, tunnelPort),
        reaped,
      ]);
      if (running?.server !== server || !server.listening) return;
      if (!ours) return rebind("connections there don't reach AgentOS");
      bindError = undefined;
      bindDelay = bindDelays.min;
      if (!running.supervisor) running.supervisor = startTunnel();
    });
    const beat = deps.heartbeat ?? sendHeartbeat;
    const version = appVersion();
    const heartbeat = startHeartbeat({
      beat: () => beat(config, machineKey, version),
      log,
      intervalMs: deps.heartbeatMs,
      onDisabled: () => {
        halted = config.machineId;
        down("disabled in your account");
      },
      onGone: () => {
        halted = config.machineId;
        down("machine no longer linked");
      },
    });
    running = {
      server,
      sockets,
      supervisor: null,
      heartbeat,
      release: lock.release,
    };
    server.listen(tunnelPort, "127.0.0.1");
  };

  // Runs from a file watcher and a timer in the live server: never throws.
  const sync = () => {
    try {
      const read = readConnect(dir);
      if (
        halted &&
        (!read.ok || !read.enabled || read.files.config.machineId !== halted)
      )
        halted = null;
      const want = read.ok && read.enabled && !halted;
      if (running && !want) down(read.ok ? "turned off" : read.reason);
      else if (!running && want) up();
      else if (!running) up(); // refreshes what the status shows
    } catch (err) {
      log(`connect: ${(err as Error).message}`);
    }
  };

  sync();
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {}
  fs.watchFile(path.join(dir, "connect.json"), { interval: 2000 }, sync);
  const stop = () => down("shutting down");
  process.once("exit", stop);
  return {
    hostname: () => (running ? hostname || null : (base.hostname ?? null)),
    /** Tests: stop watching and close everything. */
    close() {
      fs.unwatchFile(path.join(dir, "connect.json"), sync);
      process.removeListener("exit", stop);
      down("closed");
    },
  };
}
