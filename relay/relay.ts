/**
 * The Connect relay. One TCP port:
 * - TLS for the relay's own name is terminated here: /health and the
 *   machines' /tunnel WebSocket.
 * - TLS for <id>.<machine domain> is never opened. Its bytes go, as they
 *   are, down that machine's tunnel. The relay holds no key for those names.
 */

import net from "net";
import { Duplex } from "stream";
import https from "https";
import { WebSocketServer, type WebSocket } from "ws";
import { Mux } from "@/lib/connect/mux";
import { encode, Frame, json } from "@/lib/connect/frames";
import { NonceCache, verifyHello, type Hello } from "@/lib/connect/identity";
import { parseSni } from "./sni";

export interface KeyStore {
  publicKey(machineId: string): Promise<string | null>;
}

export interface RelayOptions {
  relayHost: string;
  machineDomain: string;
  tls: { key: string; cert: string };
  keys: KeyStore;
  log?: (line: string) => void;
}

const HELLO_TIMEOUT_MS = 10_000;
const MAX_HELLO_BYTES = 16 * 1024;

/**
 * The socket as a plain stream, with the bytes already read put back in
 * front. TLS servers read a net.Socket's native handle directly, which
 * would skip anything unshift()ed; a plain Duplex makes them use the stream.
 */
function replay(socket: net.Socket, first: Buffer): Duplex {
  const d = new Duplex({
    read() {
      socket.resume();
    },
    write(chunk, _enc, done) {
      socket.write(chunk, done);
    },
    final(done) {
      socket.end();
      done();
    },
    destroy(err, done) {
      socket.destroy();
      done(err);
    },
  });
  d.push(first);
  socket.on("data", (c) => {
    if (!d.push(c)) socket.pause();
  });
  socket.on("end", () => d.push(null));
  socket.on("close", () => d.destroy());
  return d;
}

export function createRelay(opts: RelayOptions) {
  const log = opts.log ?? (() => {});
  const tunnels = new Map<string, Mux>();
  const nonces = new NonceCache();
  const suffix = `.${opts.machineDomain}`;

  const own = https.createServer(opts.tls, (req, res) => {
    if (req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, machines: tunnels.size }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  own.on("upgrade", (req, socket, head) => {
    if (req.url !== "/tunnel") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => acceptMachine(ws));
  });

  function acceptMachine(ws: WebSocket) {
    let machineId: string | null = null;
    const mux = new Mux(ws);
    const timer = setTimeout(() => ws.close(), HELLO_TIMEOUT_MS);
    ws.on("message", async (data: Buffer) => {
      if (machineId) {
        mux.handle(data);
        return;
      }
      const f = mux.handle(data);
      if (f?.type !== Frame.HELLO) return ws.close();
      const hello = json<Hello>(f.payload);
      const check = verifyHello(
        hello,
        hello?.machineId ? await opts.keys.publicKey(hello.machineId) : null,
        nonces
      );
      clearTimeout(timer);
      if (!check.ok) {
        log(`machine refused: ${check.error}`);
        ws.send(encode(Frame.DENIED, 0, { error: check.error }));
        return ws.close();
      }
      machineId = check.machineId;
      // A machine that reconnects replaces its old tunnel.
      const old = tunnels.get(machineId);
      if (old) old.closeAll();
      tunnels.set(machineId, mux);
      ws.send(encode(Frame.READY, 0, { hostname: `${machineId}${suffix}` }));
      log(`machine up: ${machineId}`);
    });
    ws.on("close", () => {
      clearTimeout(timer);
      mux.closeAll();
      if (machineId && tunnels.get(machineId) === mux) {
        tunnels.delete(machineId);
        log(`machine down: ${machineId}`);
      }
    });
    ws.on("error", () => ws.close());
  }

  function route(socket: net.Socket, first: Buffer, servername: string | null) {
    if (servername === opts.relayHost) {
      own.emit("connection", replay(socket, first));
      return;
    }
    const id = servername?.endsWith(suffix)
      ? servername.slice(0, -suffix.length)
      : null;
    const mux = id && !id.includes(".") ? tunnels.get(id) : undefined;
    if (!mux) {
      log(`dropped: no machine for ${servername ?? "(no server name)"}`);
      return socket.destroy();
    }
    const stream = mux.open({ remote: socket.remoteAddress });
    stream.write(first);
    socket.pipe(stream).pipe(socket);
    const end = () => {
      socket.destroy();
      stream.destroy();
    };
    socket.on("error", end);
    socket.on("close", end);
    stream.on("close", end);
  }

  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => socket.destroy(), HELLO_TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const sni = parseSni(buf);
      if (sni.status === "more" && buf.length < MAX_HELLO_BYTES) return;
      clearTimeout(timer);
      socket.off("data", onData);
      if (sni.status !== "ok") {
        log(`dropped: ${sni.status} hello (${buf.length} bytes)`);
        return socket.destroy();
      }
      socket.pause();
      route(socket, buf, sni.servername);
      socket.resume();
    };
    socket.on("data", onData);
    socket.on("error", () => socket.destroy());
  });

  return { server, tunnels };
}
