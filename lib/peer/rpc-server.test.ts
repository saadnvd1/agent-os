import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import http, { type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import {
  fakeMachine,
  writeConnectDir,
  type FakeMachine,
} from "@/lib/__fixtures__/peer-machine";
import { tunnelListener } from "@/lib/connect/serve";
import {
  createConnectHost,
  deleteHost,
  createHost,
  getHost,
  listRemoteHosts,
  sshTargetFor,
} from "@/lib/hosts";
import {
  HostApiError,
  hostApi,
  hostLink,
  linkedHostIds,
  requireTokenLink,
} from "@/lib/hosts/remote-api";
import { getDb } from "@/lib/db";
import { gateRequest, gateUpgrade } from "@/lib/security/gate";
import type { AuthPolicy } from "@/lib/security/auth";
import { peerAudit, recordPeerCall, resetAuditLimits } from "./audit";
import {
  MAX_REQUEST_ENVELOPE,
  sealRequest,
  type PeerRequest,
} from "./envelope";
import { peerSecret } from "./internal";
import { boxPublic } from "./keys";
import { pinForHost, savePin, suspendPin, type PeerPin } from "./links";
import { createReplayGuard } from "./replay";
import {
  createBodyBudget,
  handlePeerRpc,
  isPeerRpc,
  loopbackDispatch,
  type RpcDeps,
} from "./rpc-server";

const A = fakeMachine("aaaa1111");
const B = fakeMachine("bbbb2222");
const C = fakeMachine("cccc3333");
process.env.AGENTOS_CONNECT_DIR = writeConnectDir(A);

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

/** What Next would be: echoes how the gate saw the call. */
function fakeNext(seen: Seen[]) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const c of req) body += c;
    seen.push({
      method: req.method ?? "",
      url: req.url ?? "",
      headers: { ...req.headers },
      body,
    });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Set-Cookie", "aos_device=leak");
    if (req.url?.startsWith("/api/tasks/t-9/merge")) {
      res.statusCode = 409;
      return res.end(JSON.stringify({ error: "not mergeable" }));
    }
    res.end(
      JSON.stringify({
        url: req.url,
        method: req.method,
        trust: req.headers["x-agentos-trust"],
        device: req.headers["x-agentos-device"],
        peer: req.headers["x-agentos-peer"],
        internal: req.headers["x-agentos-peer-internal"] ?? null,
        body: body ? JSON.parse(body) : null,
      })
    );
  };
}

interface Machine {
  hostname: string;
  tunnelPort: number;
  seen: Seen[];
  deps: RpcDeps;
  close: () => Promise<void>;
}

const listen = (s: http.Server) =>
  new Promise<number>((r) =>
    s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port))
  );

/** One machine's AgentOS: its loopback listener and its tunnel listener. */
async function machine(
  me: FakeMachine,
  pinFor: (machineId: string) => PeerPin | null
): Promise<Machine> {
  const seen: Seen[] = [];
  const policy: AuthPolicy = {
    tailnet: [],
    lookup: (t) => (t === "aosd_phone" ? { id: "phone" } : null),
    peerSecret,
  };
  const next = fakeNext(seen);
  let internalPort = 0;
  const deps: RpcDeps = {
    identity: () => me,
    boxKey: () => me.box,
    pinForMachine: pinFor,
    replay: createReplayGuard(),
    dispatch: (d: Parameters<ReturnType<typeof loopbackDispatch>>[0]) =>
      loopbackDispatch(internalPort)(d),
    audit: recordPeerCall,
    budget: createBodyBudget(),
  };
  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    if (!gateRequest(req, res, policy)) return;
    if (isPeerRpc(req)) return void handlePeerRpc(req, res, deps);
    void next(req, res);
  };
  const internal = http.createServer(onRequest);
  internalPort = await listen(internal);
  const tunnel = tunnelListener(() => me.hostname, {
    onRequest,
    onUpgrade: (req, socket) => {
      if (!gateUpgrade(req, socket, policy)) return;
      socket.end("HTTP/1.1 101 Switching Protocols\r\n\r\n");
    },
  });
  const tunnelPort = await listen(tunnel);
  return {
    hostname: me.hostname,
    tunnelPort,
    seen,
    deps,
    close: async () => {
      await new Promise((r) => internal.close(r));
      await new Promise((r) => tunnel.close(r));
    },
  };
}

/** What Cloudflare does: https://<m- name>/… to that machine's tunnel. */
function edge(
  machines: Machine[],
  tamper?: (body: Buffer) => Buffer
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const m = machines.find((x) => x.hostname === url.hostname);
    if (url.protocol !== "https:" || !m) throw new Error("no such host");
    const body = init?.body ? Buffer.from(init.body as Uint8Array) : undefined;
    const { status, buf } = await new Promise<{ status: number; buf: Buffer }>(
      (resolve, reject) => {
        const out = http.request(
          {
            host: "127.0.0.1",
            port: m.tunnelPort,
            method: init?.method ?? "GET",
            path: url.pathname + url.search,
            headers: {
              ...(init?.headers as Record<string, string>),
              host: url.hostname,
              ...(body && { "content-length": String(body.length) }),
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                buf: Buffer.concat(chunks),
              })
            );
          }
        );
        out.on("error", reject);
        out.end(body);
      }
    );
    return new Response(new Uint8Array(tamper ? tamper(buf) : buf), { status });
  }) as typeof fetch;
}

let mB: Machine;
let mC: Machine;
let hostB: string; // B, as A knows it
let hostA: string; // A, as B knows it

const pinOf = (m: FakeMachine, hostId: string) => ({
  hostId,
  machineId: m.machineId,
  hostname: m.hostname,
  signPub: m.signPub,
  boxPub: m.box.publicRaw,
});

beforeAll(async () => {
  hostB = createConnectHost("box-b").id;
  savePin(pinOf(B, hostB));
  hostA = createConnectHost("mac-a").id;
  savePin(pinOf(A, hostA));
  mB = await machine(B, (id) =>
    id === A.machineId ? pinForHost(hostA) : null
  );
  // C has linked A too (its own pin, not in this database).
  mC = await machine(C, (id) =>
    id === A.machineId
      ? { ...pinOf(A, "a-on-c"), state: "active", suspendedReason: null }
      : null
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await mB.close();
  await mC.close();
});

beforeEach(() => {
  vi.stubGlobal("fetch", edge([mB, mC]));
  resetAuditLimits();
  getDb().prepare(`DELETE FROM peer_audit`).run();
  mB.seen.length = 0;
  mC.seen.length = 0;
});

const linkB = () => {
  const link = hostLink(hostB);
  if (!link) throw new Error("no link");
  return link;
};

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err as HostApiError;
  }
  throw new Error("expected a refusal");
};

/** A raw POST to a machine's rpc through the edge. */
async function post(m: Machine, body: Buffer) {
  const res = await fetch(`https://${m.hostname}/api/peer/rpc`, {
    method: "POST",
    body: new Uint8Array(body),
  });
  return { status: res.status, text: await res.text() };
}

const sealAt = (
  inner: Partial<PeerRequest>,
  o: { to?: FakeMachine; now?: number; signKey?: FakeMachine["signKey"] } = {}
) =>
  sealRequest({
    from: A.machineId,
    to: (o.to ?? B).machineId,
    signKey: o.signKey ?? A.signKey,
    peerBox: boxPublic((o.to ?? B).box.publicRaw),
    request: {
      method: "GET",
      path: "/api/sessions/status",
      query: "",
      contentType: "",
      body: Buffer.alloc(0),
      ...inner,
    },
    now: o.now,
  });

describe("hostApi over a Connect link", () => {
  it("reads the pin as a connect link with no token", () => {
    const link = linkB();
    expect(link.transport).toBe("connect");
    expect(link.token).toBe("");
    expect(link.connect?.machineId).toBe(B.machineId);
    expect(linkedHostIds().has(hostB)).toBe(true);
    expect(getHost(hostB)?.kind).toBe("connect");
  });

  it("reaches an allowlisted route with peer trust and nothing else", async () => {
    const got = await hostApi<Record<string, unknown>>(
      linkB(),
      "/api/sessions/status"
    );
    expect(got).toMatchObject({
      url: "/api/sessions/status",
      method: "GET",
      trust: "peer",
      device: `peer:${hostA}`,
      peer: hostA,
      internal: null,
    });
    expect(mB.seen).toHaveLength(1);
    expect(mB.seen[0].headers.cookie).toBeUndefined();
    expect(mB.seen[0].headers.authorization).toBeUndefined();
  });

  it("carries a JSON body and the route's query", async () => {
    const got = await hostApi<Record<string, unknown>>(linkB(), "/api/tasks", {
      body: { prompt: "hi" },
    });
    expect(got).toMatchObject({ method: "POST", body: { prompt: "hi" } });
    const tail = await hostApi<Record<string, unknown>>(
      linkB(),
      "/api/tasks/t-1/chat-tail?lines=5"
    );
    expect(tail.url).toBe("/api/tasks/t-1/chat-tail?lines=5");
  });

  it("passes the route's status through as a refusal, like the token transport", async () => {
    const err = await refusal(
      hostApi(linkB(), "/api/tasks/t-9/merge", { body: {} })
    );
    expect(err).toBeInstanceOf(HostApiError);
    expect(err.message).toBe("box-b: not mergeable");
    expect(err.refused).toBe(true);
    expect(err.status).toBe(409);
  });

  it("refuses a route off the allowlist before sending anything", async () => {
    const spy = vi.fn(edge([mB]));
    vi.stubGlobal("fetch", spy);
    for (const path of [
      "/api/devices",
      "/api/tasks/../devices",
      "/api/sessions?all=1",
    ]) {
      const err = await refusal(hostApi(linkB(), path));
      expect(err.refused).toBe(true);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a link whose address isn't a Connect machine's", async () => {
    getDb()
      .prepare(`UPDATE peer_links SET hostname = '127.0.0.1' WHERE host_id = ?`)
      .run(hostB);
    try {
      const err = await refusal(hostApi(linkB(), "/api/sessions"));
      expect(err.refused).toBe(true);
      expect(err.message).toMatch(/isn't a Connect machine/);
    } finally {
      savePin(pinOf(B, hostB));
    }
  });

  it("refuses a suspended link on either side", async () => {
    suspendPin(hostB, "removed from your account");
    try {
      const err = await refusal(hostApi(linkB(), "/api/sessions"));
      expect(err.refused).toBe(true);
      expect(err.message).toMatch(/suspended/);
    } finally {
      savePin(pinOf(B, hostB));
    }
    suspendPin(hostA, "removed from your account");
    try {
      const err = await refusal(hostApi(linkB(), "/api/sessions"));
      expect(err.refused).toBe(true);
      // Same answer as a bad signature; only B's audit says why.
      expect(err.status).toBe(401);
      expect(err.message).toMatch(/bad signature/);
      expect(mB.seen).toHaveLength(0);
      expect(peerAudit(hostA)[0]).toMatchObject({ outcome: "suspended" });
    } finally {
      savePin(pinOf(A, hostA));
    }
  });

  it("treats an answer that isn't bound to this request as unknown, not refused", async () => {
    let first: Buffer | null = null;
    vi.stubGlobal(
      "fetch",
      edge([mB], (body) => (first ??= body))
    );
    await hostApi(linkB(), "/api/sessions/status");
    const err = await refusal(hostApi(linkB(), "/api/sessions/status"));
    expect(err.refused).toBe(false);
    expect(err.message).toMatch(/isn't signed by the linked machine/);
  });

  it("treats a tampered answer as unknown", async () => {
    vi.stubGlobal(
      "fetch",
      edge([mB], (body) => {
        const bad = Buffer.from(body);
        bad[3] ^= 1;
        return bad;
      })
    );
    const err = await refusal(hostApi(linkB(), "/api/sessions/status"));
    expect(err.refused).toBe(false);
  });

  it("trusts an unsigned refusal only on reads: on a write it may have run", async () => {
    vi.stubGlobal(
      "fetch",
      (async () =>
        new Response("bad signature", { status: 401 })) as typeof fetch
    );
    const read = await refusal(hostApi(linkB(), "/api/sessions/status"));
    expect(read.refused).toBe(true);
    const write = await refusal(hostApi(linkB(), "/api/tasks", { body: {} }));
    expect(write.refused).toBe(false);
  });

  it("audits both sides, folding successful reads into one row per hour", async () => {
    await hostApi(linkB(), "/api/sessions/status");
    await hostApi(linkB(), "/api/sessions/status");
    await hostApi(linkB(), "/api/tasks", { body: {} });
    const out = peerAudit(hostB);
    const inn = peerAudit(hostA);
    expect(out.filter((r) => r.direction === "out")).toHaveLength(2);
    expect(inn.filter((r) => r.direction === "in")).toHaveLength(2);
    expect(out.find((r) => r.route === "/api/sessions/status")).toMatchObject({
      count: 2,
      outcome: "ok",
      status: 200,
    });
    expect(inn.find((r) => r.route === "/api/tasks")).toMatchObject({
      method: "POST",
      count: 1,
      outcome: "ok",
    });
  });

  it("counts only the link that matches a machine's kind as linked", () => {
    const ssh = createHost("ssh-box", "dev@box").id;
    const conn = createConnectHost("conn-box").id;
    try {
      // A pin on an ssh machine, a token on a Connect one: neither links it.
      savePin(pinOf(fakeMachine("ffff6666"), ssh));
      getDb()
        .prepare(
          `INSERT INTO host_links (host_id, url, token) VALUES (?, ?, ?)`
        )
        .run(conn, "http://box:3011", "tok");
      const linked = (id: string) =>
        !!(listRemoteHosts().find((h) => h.id === id) as { linked?: number })
          ?.linked;
      expect(linked(ssh)).toBe(false);
      expect(linked(conn)).toBe(false);
      expect(linked(hostB)).toBe(true);
      expect(linkedHostIds().has(ssh)).toBe(false);
      expect(linkedHostIds().has(conn)).toBe(false);
    } finally {
      deleteHost(ssh);
      deleteHost(conn);
    }
  });

  it("never lets ssh paths or token-only features use a Connect host", () => {
    expect(() => sshTargetFor(hostB)).toThrow(/Connect/);
    expect(() => requireTokenLink(linkB())).toThrow(/Connect/);
  });

  it("forgets the pin with the machine", () => {
    const id = createConnectHost("gone").id;
    savePin(pinOf(fakeMachine("dddd4444"), id));
    deleteHost(id);
    expect(
      getDb().prepare(`SELECT 1 FROM peer_links WHERE host_id = ?`).get(id)
    ).toBeUndefined();
  });
});

describe("the rpc server against hostile envelopes", () => {
  it("refuses a replayed envelope, running the call once", async () => {
    const { envelope } = sealAt({});
    expect((await post(mB, envelope)).status).toBe(200);
    expect(await post(mB, envelope)).toEqual({ status: 401, text: "replay" });
    expect(mB.seen).toHaveLength(1);
    expect(peerAudit(hostA).map((r) => r.outcome)).toContain("replay");
  });

  it("refuses an envelope for another machine (cross-machine replay)", async () => {
    const { envelope } = sealAt({}, { to: B });
    // C has A pinned too, but the envelope names B.
    expect(await post(mC, envelope)).toEqual({
      status: 401,
      text: "bad signature",
    });
    expect(mC.seen).toHaveLength(0);
  });

  it("refuses a stale envelope", async () => {
    const { envelope } = sealAt({}, { now: Date.now() - 121_000 });
    expect(await post(mB, envelope)).toEqual({ status: 401, text: "stale" });
  });

  it("refuses a signature by the wrong key", async () => {
    const { envelope } = sealAt({}, { signKey: C.signKey });
    expect(await post(mB, envelope)).toEqual({
      status: 401,
      text: "bad signature",
    });
    expect(mB.seen).toHaveLength(0);
  });

  it("refuses a sender it hasn't pinned", async () => {
    const { envelope } = sealRequest({
      from: "eeee5555",
      to: B.machineId,
      signKey: C.signKey,
      peerBox: boxPublic(B.box.publicRaw),
      request: {
        method: "GET",
        path: "/api/sessions",
        query: "",
        contentType: "",
        body: Buffer.alloc(0),
      },
    });
    // Indistinguishable from a bad signature to whoever sent it.
    expect(await post(mB, envelope)).toEqual({
      status: 401,
      text: "bad signature",
    });
    const row = getDb()
      .prepare(`SELECT * FROM peer_audit WHERE machine_id = 'eeee5555'`)
      .get() as { outcome: string; host_id: string | null };
    expect(row).toMatchObject({ outcome: "unknown_peer", host_id: null });
  });

  it("refuses a tampered envelope", async () => {
    const { envelope } = sealAt({});
    const bad = Buffer.from(envelope);
    bad[bad.length - 100] ^= 1;
    expect((await post(mB, bad)).status).toBe(401);
    expect(mB.seen).toHaveLength(0);
  });

  it.each([
    ["GET", "/api/devices", ""],
    ["POST", "/api/pair/start", ""],
    ["POST", "/api/hosts/h/link", ""],
    ["GET", "/api/tasks/../devices", ""],
    ["GET", "/api/tasks/%2e%2e/devices", ""],
    ["GET", "//api/sessions", ""],
    ["GET", "http://127.0.0.1:1/api/sessions", ""],
    ["GET", "/api/sessions", "all=1"],
    ["PUT", "/api/sessions", ""],
  ])(
    "answers %s %s?%s with a sealed 403 and never dispatches it",
    async (method, path, query) => {
      const sealed = sealAt({ method, path, query });
      const res = await fetch(`https://${B.hostname}/api/peer/rpc`, {
        method: "POST",
        body: new Uint8Array(sealed.envelope),
      });
      // Outside, it's an ordinary 200: the route and status stay sealed.
      expect(res.status).toBe(200);
      const { openResponse } = await import("./envelope");
      const { signPublic } = await import("./keys");
      const answer = openResponse({
        envelope: Buffer.from(await res.arrayBuffer()),
        nonce: sealed.nonce,
        resKey: sealed.resKey,
        peerSign: signPublic(B.signPub),
      });
      expect(answer.status).toBe(403);
      expect(mB.seen).toHaveLength(0);
      expect(peerAudit(hostA)[0]).toMatchObject({
        outcome: "denied_route",
        route: "(denied)",
      });
    }
  );

  it("never forwards the answer's cookies", async () => {
    const sealed = sealAt({});
    const res = await fetch(`https://${B.hostname}/api/peer/rpc`, {
      method: "POST",
      body: new Uint8Array(sealed.envelope),
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses an oversized body before reading it", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const out = http.request(
        {
          host: "127.0.0.1",
          port: mB.tunnelPort,
          method: "POST",
          path: "/api/peer/rpc",
          headers: {
            host: B.hostname,
            "content-length": String(MAX_REQUEST_ENVELOPE + 1),
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      out.on("error", reject);
      out.flushHeaders();
    });
    expect(status).toBe(413);
  });

  it("refuses an unpinned sender as soon as its header arrives", async () => {
    const { envelope } = sealRequest({
      from: "eeee5555",
      to: B.machineId,
      signKey: C.signKey,
      peerBox: boxPublic(B.box.publicRaw),
      request: {
        method: "POST",
        path: "/api/tasks/import",
        query: "",
        contentType: "application/json",
        body: Buffer.alloc(1024),
      },
    });
    const headerEnd = 4 + envelope.readUInt32BE(0);
    const status = await new Promise<number>((resolve, reject) => {
      const out = http.request(
        {
          host: "127.0.0.1",
          port: mB.tunnelPort,
          method: "POST",
          path: "/api/peer/rpc",
          headers: { host: B.hostname, "content-length": "50000000" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      out.on("error", reject);
      // The header only; the 50 MB it promised never comes.
      out.write(envelope.subarray(0, headerEnd));
    });
    expect(status).toBe(401);
  });

  it("caps audit rows for forged envelopes claiming a linked sender", async () => {
    const { envelope } = sealAt({}, { signKey: C.signKey });
    for (let i = 0; i < 40; i++)
      expect((await post(mB, envelope)).status).toBe(401);
    const rows = peerAudit(hostA).filter((r) => r.outcome === "bad_sig");
    expect(rows).toHaveLength(30);
  });

  it("holds only so much unverified envelope per sender, then says busy", async () => {
    const saved = mB.deps.budget;
    mB.deps.budget = createBodyBudget({ total: 1 << 20, perPeer: 8192 });
    const sealPost = (bytes: number) =>
      sealAt({
        method: "POST",
        path: "/api/tasks",
        contentType: "application/json",
        body: Buffer.from(JSON.stringify({ pad: "x".repeat(bytes) })),
      }).envelope;
    try {
      const slow = sealPost(6000);
      // A half-sent envelope from A holds ~6 KB of A's 8 KB.
      const pending = http.request({
        host: "127.0.0.1",
        port: mB.tunnelPort,
        method: "POST",
        path: "/api/peer/rpc",
        headers: { host: B.hostname, "content-length": String(slow.length) },
      });
      const closed = new Promise((r) => pending.on("close", r));
      pending.on("error", () => {});
      await new Promise<void>((r) =>
        pending.write(slow.subarray(0, slow.length - 10), () => r())
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(await post(mB, sealPost(4000))).toEqual({
        status: 429,
        text: "busy",
      });
      expect(mB.seen).toHaveLength(0);
      // Once that one is gone its bytes are given back.
      pending.destroy();
      await closed;
      await new Promise((r) => setTimeout(r, 50));
      expect((await post(mB, sealPost(4000))).status).toBe(200);
    } finally {
      mB.deps.budget = saved;
    }
  });

  it("refuses a header longer than any envelope's", async () => {
    const big = Buffer.alloc(8);
    big.writeUInt32BE(5000);
    expect(await post(mB, big)).toEqual({ status: 400, text: "bad envelope" });
  });

  it("answers only POST", async () => {
    const res = await fetch(`https://${B.hostname}/api/peer/rpc`);
    expect(res.status).toBe(405);
  });

  it("refuses an upgrade on the rpc path", async () => {
    const line = await new Promise<string>((resolve, reject) => {
      const out = http.request({
        host: "127.0.0.1",
        port: mB.tunnelPort,
        path: "/api/peer/rpc",
        headers: {
          host: B.hostname,
          connection: "Upgrade",
          upgrade: "websocket",
        },
      });
      out.on("response", (res) => resolve(String(res.statusCode)));
      out.on("upgrade", () => resolve("upgraded"));
      out.on("error", reject);
      out.end();
    });
    expect(line).toBe("401");
  });

  it("still refuses a tunnel request with no envelope or token", async () => {
    const res = await fetch(`https://${B.hostname}/api/sessions`);
    expect(res.status).toBe(401);
  });

  it("refuses the internal header from outside, even with the right secret", async () => {
    const res = await new Promise<number>((resolve, reject) => {
      const out = http.request(
        {
          host: "127.0.0.1",
          port: mB.tunnelPort,
          path: "/api/sessions/status",
          headers: {
            host: B.hostname,
            "x-agentos-peer-internal": peerSecret(),
            "x-agentos-peer": hostA,
          },
        },
        (r) => {
          r.resume();
          resolve(r.statusCode ?? 0);
        }
      );
      out.on("error", reject);
      out.end();
    });
    expect(res).toBe(401);
    expect(mB.seen).toHaveLength(0);
  });
});
