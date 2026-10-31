import { describe, it, expect, afterAll, afterEach } from "vitest";
import crypto from "crypto";
import { EventEmitter } from "events";
import fs from "fs";
import http from "http";
import net, { type AddressInfo } from "net";
import path from "path";
import { PassThrough } from "stream";
import { gateRequest, gateUpgrade } from "@/lib/security/gate";
import {
  DEVICE_HEADER,
  REMOTE_HEADER,
  TRUST_HEADER,
  type AuthPolicy,
} from "@/lib/security/auth";
import {
  connectStatus,
  listenerIsOurs,
  startConnect,
  tunnelListener,
  type ConnectDeps,
  type Handlers,
} from "./serve";
import type { Spawn } from "./supervise";
import { tempDir } from "@/lib/test-temp";

const HOST = "m-0123456789abcdef.runagentos.com";
// A paired device's token, made per run.
const DEVICE_TOKEN = `aosd_${crypto.randomBytes(16).toString("hex")}`;
const fakeToken = () =>
  Buffer.from(
    JSON.stringify({
      a: crypto.randomBytes(16).toString("hex"),
      t: crypto.randomUUID(),
      s: crypto.randomBytes(32).toString("base64"),
    })
  ).toString("base64");

/** What server.ts does past net.ts: the real gate, then a handler that says who it saw. */
function gated(policy: AuthPolicy) {
  const seen: http.IncomingHttpHeaders[] = [];
  const handlers: Handlers = {
    onRequest: (req, res) => {
      if (!gateRequest(req, res, policy)) return;
      seen.push({ ...req.headers });
      res.end(
        JSON.stringify({
          trust: req.headers[TRUST_HEADER],
          device: req.headers[DEVICE_HEADER],
        })
      );
    },
    onUpgrade: (req, socket) => {
      if (!gateUpgrade(req, socket, policy)) return;
      socket.end("HTTP/1.1 101 Switching Protocols\r\n\r\n");
    },
  };
  return { handlers, seen };
}

const servers: http.Server[] = [];
afterAll(() => servers.forEach((s) => s.close()));

async function listen(server: http.Server) {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

function get(
  port: number,
  headers: Record<string, string>,
  pathname = "/api/sessions"
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, headers, setHost: false },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function upgrade(port: number, headers: Record<string, string>) {
  return new Promise<string>((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => {
      s.write(
        `GET /ws/terminal HTTP/1.1\r\n${Object.entries({
          connection: "Upgrade",
          upgrade: "websocket",
          ...headers,
        })
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n")}\r\n\r\n`
      );
    });
    let data = "";
    s.on("data", (c) => (data += c));
    s.on("close", () => resolve(data.split("\r\n")[0]));
    s.on("error", () => resolve(data.split("\r\n")[0]));
  });
}

describe("the tunnel listener", () => {
  const policy: AuthPolicy = {
    tailnet: [],
    lookup: (t) => (t === DEVICE_TOKEN ? { id: "dev-1" } : null),
  };

  it("is a stranger from loopback with the machine's own Host and no forwarding headers", async () => {
    const { handlers } = gated(policy);
    const port = await listen(tunnelListener(() => HOST, handlers));
    const r = await get(port, { host: HOST });
    expect(r.status).toBe(401);
    expect(r.body).toContain("pairing required");
  });

  it("refuses a localhost Host outright (it would look like this machine)", async () => {
    const { handlers, seen } = gated(policy);
    const port = await listen(tunnelListener(() => HOST, handlers));
    for (const host of [
      "localhost",
      `localhost:${port}`,
      "127.0.0.1",
      "[::1]",
      `${HOST}.evil.com`,
      `${HOST}:443`,
    ]) {
      expect((await get(port, { host })).status).toBe(421);
      expect(
        (await get(port, { host, authorization: `Bearer ${DEVICE_TOKEN}` }))
          .status
      ).toBe(421);
    }
    expect(seen).toHaveLength(0);
  });

  it("strips spoofed forwarding headers and still wants a paired device", async () => {
    const { handlers, seen } = gated(policy);
    const port = await listen(tunnelListener(() => HOST, handlers));
    const spoofed = {
      host: HOST,
      "x-forwarded-host": "localhost",
      forwarded: "for=127.0.0.1;host=localhost;proto=http",
      "x-original-host": "127.0.0.1",
      "x-forwarded-for": "127.0.0.1",
    };
    expect((await get(port, spoofed)).status).toBe(401);
    const ok = await get(port, {
      ...spoofed,
      authorization: `Bearer ${DEVICE_TOKEN}`,
    });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ trust: "device", device: "dev-1" });
    expect(seen[0]["x-forwarded-host"]).toBeUndefined();
    expect(seen[0].forwarded).toBeUndefined();
    expect(seen[0]["x-original-host"]).toBeUndefined();
    expect(seen[0][REMOTE_HEADER]).toBe("connect");
  });

  it("never lets AGENTOS_AUTH=off open it", async () => {
    const { handlers } = gated({ ...policy, off: true });
    const port = await listen(tunnelListener(() => HOST, handlers));
    expect((await get(port, { host: HOST })).status).toBe(401);
  });

  it("refuses an unpaired or misaddressed WebSocket upgrade", async () => {
    const { handlers } = gated(policy);
    const port = await listen(tunnelListener(() => HOST, handlers));
    expect(await upgrade(port, { host: "localhost" })).toContain("421");
    expect(await upgrade(port, { host: HOST })).toContain("401");
    expect(
      await upgrade(port, {
        host: HOST,
        "x-forwarded-host": "localhost",
        forwarded: "host=localhost",
      })
    ).toContain("401");
    expect(
      await upgrade(port, {
        host: HOST,
        authorization: `Bearer ${DEVICE_TOKEN}`,
      })
    ).toContain("101");
  });

  it("serves nothing until the machine has a name", async () => {
    const { handlers } = gated(policy);
    const port = await listen(tunnelListener(() => "", handlers));
    expect((await get(port, { host: "" })).status).toBe(421);
    expect((await get(port, { host: "localhost" })).status).toBe(421);
  });
});

describe("startConnect", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
    delete process.env.AGENTOS_CONNECT_DIR;
  });

  async function freePort() {
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const p = (s.address() as AddressInfo).port;
    await new Promise((r) => s.close(r));
    return p;
  }

  /** A linked machine with an old relay name, and a cloudflared stand-in. */
  async function machine() {
    const dir = tempDir("connect-serve-");
    process.env.AGENTOS_CONNECT_DIR = dir;
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    fs.writeFileSync(
      path.join(dir, "machine.key"),
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      { mode: 0o600 }
    );
    fs.writeFileSync(
      path.join(dir, "connect.json"),
      JSON.stringify({
        machineId: "k7q2mz9x",
        hostname: "k7q2mz9x.on.runagentos.com",
        relayUrl: "wss://relay.example",
        apiUrl: "https://runagentos.com",
      })
    );
    const asked: number[] = [];
    // What happened, in order: binds seen by cloudflared, kills, spawns.
    const events: string[] = [];
    const children: (EventEmitter & { signals: string[] })[] = [];
    const spawn: Spawn = (_bin, _args, opts) => {
      const c = Object.assign(new EventEmitter(), {
        pid: 0,
        env: opts.env,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        signals: [] as string[],
        kill(sig: NodeJS.Signals = "SIGTERM") {
          c.signals.push(sig);
          setImmediate(() => c.emit("exit", null));
          return true;
        },
      });
      children.push(c);
      events.push("spawn");
      setImmediate(() =>
        c.stderr.write(
          JSON.stringify({
            level: "info",
            message: "Registered tunnel connection",
            connIndex: 0,
          }) + "\n"
        )
      );
      return c;
    };
    return { dir, asked, children, spawn, events };
  }

  const until = async (cond: () => boolean) => {
    const end = Date.now() + 8000;
    while (!cond()) {
      if (Date.now() > end) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  function start(
    m: Awaited<ReturnType<typeof machine>>,
    tunnelPort: number,
    heartbeat: () => Promise<{ enabled: boolean }> = async () => ({
      enabled: true,
    }),
    extra: Partial<ConnectDeps> = {}
  ) {
    const g = gated({ tailnet: [], lookup: () => null });
    const started = startConnect(
      g.handlers,
      3011,
      () => {},
      {
        ensureBinary: async (d) => path.join(d, "bin", "cloudflared"),
        requestTunnel: async (_c, _k, port) => {
          m.asked.push(port);
          return { hostname: HOST, token: fakeToken() };
        },
        spawn: m.spawn,
        heartbeat,
        delays: { min: 10, max: 40, setupMax: 40, denied: 30 },
        ...extra,
      },
      {
        NODE_ENV: "production",
        AGENTOS_CONNECT_PORT: String(tunnelPort),
      }
    );
    close = started.close;
    return started;
  }

  it("still says a linked machine is linked where Connect can't run", async () => {
    await machine();
    const g = gated({ tailnet: [], lookup: () => null });
    const started = startConnect(
      g.handlers,
      3011,
      () => {},
      {},
      {
        NODE_ENV: "development",
      }
    );
    close = started.close;
    expect(connectStatus()).toMatchObject({
      state: "refused",
      enrolled: true,
    });
  });

  it("runs cloudflared while on, names the machine, and stops it all when turned off", async () => {
    const m = await machine();
    const { dir, asked, children } = m;
    const tunnelPort = await freePort();
    const started = start(m, tunnelPort);

    await until(() => connectStatus().state === "up");
    expect(asked).toEqual([tunnelPort]);
    expect(connectStatus()).toMatchObject({ hostname: HOST, enrolled: true });
    // Up: no down clock, so a failing probe through it starts its own.
    expect(connectStatus().downSince).toBeUndefined();
    expect(started.hostname()).toBe(HOST);
    const saved = JSON.parse(
      fs.readFileSync(path.join(dir, "connect.json"), "utf8")
    );
    expect(saved).toEqual({
      machineId: "k7q2mz9x",
      hostname: HOST,
      apiUrl: "https://runagentos.com",
    });
    expect((await get(tunnelPort, { host: HOST })).status).toBe(401);

    // Turned off: cloudflared is stopped and the listener closes.
    fs.writeFileSync(
      path.join(dir, "connect.json"),
      JSON.stringify({ ...saved, enabled: false })
    );
    await until(() => connectStatus().state === "off");
    expect(children[0].signals).toContain("SIGTERM");
    await expect(get(tunnelPort, { host: HOST })).rejects.toThrow();
  }, 15_000);

  it.each([
    [
      "connector",
      { ensureBinary: () => Promise.reject(new Error("download failed")) },
    ],
    [
      "service",
      { requestTunnel: () => Promise.reject(new Error("fetch failed")) },
    ],
  ] as const)("says a failure came from the %s", async (stage, extra) => {
    const m = await machine();
    start(m, await freePort(), undefined, extra);
    await until(() => connectStatus().state === "error");
    expect(connectStatus()).toMatchObject({ stage });
    expect(connectStatus().downSince).toBeLessThanOrEqual(Date.now());
  });

  it("stops the tunnel when the heartbeat says the account disabled it, and stays off", async () => {
    const m = await machine();
    const tunnelPort = await freePort();
    let beats = 0;
    start(m, tunnelPort, async () => {
      beats++;
      return { enabled: beats < 1 };
    });
    await until(() => beats === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(connectStatus().state).toBe("off");
    expect(beats).toBe(1);
    expect(m.children.every((c) => c.signals.includes("SIGTERM"))).toBe(true);
  }, 15_000);

  it("keeps trying to bind the tunnel port while something else holds it", async () => {
    const m = await machine();
    const tunnelPort = await freePort();
    const squatter = net.createServer();
    await new Promise<void>((r) => squatter.listen(tunnelPort, "127.0.0.1", r));
    start(m, tunnelPort);
    await until(
      () => connectStatus().reason?.includes("can't listen") ?? false
    );
    expect(connectStatus().state).toBe("error");
    await new Promise((r) => squatter.close(r));
    await until(() => connectStatus().state === "up");
    expect((await get(tunnelPort, { host: HOST })).status).toBe(401);
  }, 15_000);

  it("never starts cloudflared or asks for a token while it can't hold the port", async () => {
    const m = await machine();
    const tunnelPort = await freePort();
    const squatter = net.createServer();
    await new Promise<void>((r) => squatter.listen(tunnelPort, "127.0.0.1", r));
    start(m, tunnelPort);
    await until(
      () => connectStatus().reason?.includes("can't listen") ?? false
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(m.children).toHaveLength(0);
    expect(m.asked).toHaveLength(0);
    await new Promise((r) => squatter.close(r));
    await until(() => m.children.length === 1);
    expect(connectStatus().reason ?? "").not.toContain("can't listen");
  }, 15_000);

  it("kills a cloudflared a crashed AgentOS left running before it starts one", async () => {
    const m = await machine();
    const tunnelPort = await freePort();
    fs.writeFileSync(path.join(m.dir, "cloudflared.pid"), "4242");
    const kills: [number, NodeJS.Signals | 0][] = [];
    start(m, tunnelPort, undefined, {
      reap: {
        commandOf: async (pid) =>
          pid === 4242
            ? `/bin/sh -c ... agentos-cloudflared ${m.dir}/bin/cloudflared tunnel run`
            : "",
        kill: (pid, sig) => {
          kills.push([pid, sig]);
          if (sig !== 0) m.events.push(`kill ${pid}`);
          return sig !== 0;
        },
        waitMs: 50,
      },
    });
    await until(() => m.children.length === 1);
    expect(m.events.slice(0, 3)).toEqual(["kill -4242", "kill 4242", "spawn"]);
    expect(kills.filter(([, s]) => s === "SIGKILL")).toEqual([
      [-4242, "SIGKILL"],
      [4242, "SIGKILL"],
    ]);
  }, 15_000);

  it("leaves a pid it can't tie to its own cloudflared alone", async () => {
    const m = await machine();
    const tunnelPort = await freePort();
    fs.writeFileSync(path.join(m.dir, "cloudflared.pid"), "4242");
    const kills: number[] = [];
    start(m, tunnelPort, undefined, {
      reap: {
        commandOf: async () => "/usr/sbin/sshd -D",
        kill: (pid) => (kills.push(pid), true),
      },
    });
    await until(() => m.children.length === 1);
    expect(kills).toEqual([]);
  }, 15_000);
});

describe("listenerIsOurs", () => {
  it("is true only for the server connections to the port reach", async () => {
    const ours = net.createServer((s) => s.destroy()) as unknown as http.Server;
    const port = await listen(ours);
    expect(await listenerIsOurs(ours, port)).toBe(true);
    // Listening, but somewhere else: the port belongs to another server.
    const other = net.createServer((s) =>
      s.destroy()
    ) as unknown as http.Server;
    await listen(other);
    expect(await listenerIsOurs(other, port, 300)).toBe(false);
  });

  it("is false when nothing listens", async () => {
    const lone = http.createServer();
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as AddressInfo).port;
    await new Promise((r) => s.close(r));
    expect(await listenerIsOurs(lone, port, 300)).toBe(false);
  });
});
