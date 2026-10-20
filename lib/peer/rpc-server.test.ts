import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import http from "http";
import {
  fakeMachine,
  writeConnectDir,
  type FakeMachine,
} from "@/lib/__fixtures__/peer-machine";
import {
  edge,
  machine,
  outcomesOf,
  partial,
  post,
  type Machine,
} from "@/lib/__fixtures__/peer-rpc";
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
import { peerAudit, recordPeerCall, resetAuditLimits } from "./audit";
import {
  MAX_REQUEST_ENVELOPE,
  sealRequest,
  type PeerRequest,
} from "./envelope";
import { peerSecret } from "./internal";
import { boxPublic } from "./keys";
import { hasActivePin, pinForHost, savePin, suspendPin } from "./links";
import { createBodyBudget } from "./rpc-server";

const A = fakeMachine("aaaa1111");
const B = fakeMachine("bbbb2222");
const C = fakeMachine("cccc3333");
process.env.AGENTOS_CONNECT_DIR = writeConnectDir(A);

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
    expect(outcomesOf("/api/peer/rpc")).toEqual(["too_large"]);
  });

  it("refuses an unpinned or forged sender as soon as its header is in, the same way", async () => {
    const forged = (from: string) =>
      sealRequest({
        from,
        to: B.machineId,
        signKey: C.signKey,
        peerBox: boxPublic(B.box.publicRaw),
        request: {
          method: "POST",
          path: "/api/tasks/import",
          query: "",
          contentType: "application/json",
          body: Buffer.from(JSON.stringify({ pad: "x".repeat(4000) })),
        },
      }).envelope;
    // A stranger and a forger claiming a linked machine: neither gets to
    // send its body, and both read alike.
    for (const from of ["eeee5555", A.machineId]) {
      const env = forged(from);
      const p = partial(mB, env, 4 + env.readUInt32BE(0) + 64);
      expect(await p.within(1000)).toBe("answered");
      expect(await p.response).toEqual({ status: 401, text: "bad signature" });
      p.destroy();
    }
    expect(outcomesOf("/api/peer/rpc")).toEqual(["unknown_peer", "bad_sig"]);
  });

  it("closes the route to everyone while no link is active", async () => {
    mB.deps.anyActive = hasActivePin;
    try {
      expect(hasActivePin()).toBe(true);
      suspendPin(hostA, "test");
      suspendPin(hostB, "test");
      expect(hasActivePin()).toBe(false);
      // Refused at once, without waiting for (or holding) any of the body.
      const env = sealAt({}).envelope;
      const p = partial(mB, env, 0);
      expect(await p.within(1000)).toBe("answered");
      expect(await p.response).toEqual({ status: 404, text: "not found" });
      p.destroy();
      expect(mB.seen).toHaveLength(0);
    } finally {
      mB.deps.anyActive = () => true;
      savePin(pinOf(A, hostA));
      savePin(pinOf(B, hostB));
    }
  });

  it("drops a sender that bursts and then stalls, by the rate of the last window", async () => {
    const saved = mB.deps.pace;
    // 6 KB at 1 KB/s would buy six seconds averaged over the whole body.
    mB.deps.pace = { graceMs: 100, minRate: 1000, windowMs: 200 };
    try {
      const env = sealAt({
        method: "POST",
        path: "/api/tasks",
        contentType: "application/json",
        body: Buffer.from(JSON.stringify({ pad: "x".repeat(6000) })),
      }).envelope;
      const burst = partial(mB, env, env.length - 10);
      expect(await burst.within(1500)).toBe("answered");
      expect(await burst.response).toEqual({ status: 408, text: "too slow" });
      burst.destroy();
      expect(outcomesOf("/api/peer/rpc")).toEqual(["too_slow"]);
    } finally {
      mB.deps.pace = saved;
    }
  });

  it("charges bytes that arrive before the header is complete", async () => {
    const saved = mB.deps.budget;
    mB.deps.budget = createBodyBudget({ perSource: 100 });
    try {
      const junk = Buffer.alloc(300, 0x20);
      junk.writeUInt32BE(1000, 0);
      const p = partial(mB, junk, junk.length);
      expect(await p.within(1000)).toBe("answered");
      expect(await p.response).toEqual({ status: 429, text: "busy" });
      p.destroy();
    } finally {
      mB.deps.budget = saved;
    }
  });

  it("drops a sender that stalls, and gives its share back", async () => {
    const saved = { budget: mB.deps.budget, pace: mB.deps.pace };
    mB.deps.budget = createBodyBudget({ perPeer: 8192 });
    mB.deps.pace = { graceMs: 200, minRate: 1_000_000, windowMs: 200 };
    try {
      const env = sealAt({
        method: "POST",
        path: "/api/tasks",
        contentType: "application/json",
        body: Buffer.from(JSON.stringify({ pad: "x".repeat(6000) })),
      }).envelope;
      // Claims A and holds most of A's share, then sends nothing more.
      const stalled = partial(mB, env, env.length - 10);
      await new Promise((r) => setTimeout(r, 50));
      expect(await post(mB, env)).toEqual({ status: 429, text: "busy" });
      expect(await stalled.response).toEqual({
        status: 408,
        text: "too slow",
      });
      stalled.destroy();
      expect((await post(mB, sealAt({}).envelope)).status).toBe(200);
    } finally {
      Object.assign(mB.deps, saved);
    }
  });

  it("caps open unverified requests per source, the same for linked and unknown senders", async () => {
    const saved = mB.deps.budget;
    mB.deps.budget = createBodyBudget({ requestsPerSource: 1 });
    try {
      const env = sealAt({}).envelope;
      const held = partial(mB, env, 10);
      await new Promise((r) => setTimeout(r, 50));
      const stranger = sealRequest({
        from: "eeee5555",
        to: B.machineId,
        signKey: C.signKey,
        peerBox: boxPublic(B.box.publicRaw),
        request: {
          method: "GET",
          path: "/api/sessions/status",
          query: "",
          contentType: "",
          body: Buffer.alloc(0),
        },
      }).envelope;
      expect(await post(mB, sealAt({}).envelope)).toEqual({
        status: 429,
        text: "busy",
      });
      expect(await post(mB, stranger)).toEqual({ status: 429, text: "busy" });
      expect(outcomesOf("/api/peer/rpc")).toEqual(["busy", "busy"]);
      held.destroy();
      await held.closed;
      await new Promise((r) => setTimeout(r, 50));
      expect((await post(mB, sealAt({}).envelope)).status).toBe(200);
    } finally {
      mB.deps.budget = saved;
    }
  });

  it("caps audit rows for forged envelopes claiming a linked sender", async () => {
    const { envelope } = sealAt({}, { signKey: C.signKey });
    for (let i = 0; i < 40; i++)
      expect((await post(mB, envelope)).status).toBe(401);
    const rows = peerAudit(hostA).filter((r) => r.outcome === "bad_sig");
    expect(rows).toHaveLength(30);
    // The flood spent only its own budget: this machine's own failures and
    // a linked machine's denied routes are still recorded.
    recordPeerCall({
      hostId: hostB,
      machineId: B.machineId,
      direction: "out",
      method: "POST",
      route: "/api/tasks",
      status: 401,
      ms: 1,
      bytes: 0,
      outcome: "bad_sig",
    });
    expect(peerAudit(hostB).map((r) => r.outcome)).toEqual(["bad_sig"]);
    await fetch(`https://${B.hostname}/api/peer/rpc`, {
      method: "POST",
      body: new Uint8Array(sealAt({ path: "/api/devices" }).envelope),
    });
    expect(peerAudit(hostA)[0]).toMatchObject({ outcome: "denied_route" });
  });

  it("never lets a forger claiming a linked sender spend that sender's share", async () => {
    const saved = mB.deps.budget;
    mB.deps.budget = createBodyBudget({ perPeer: 8192 });
    const body = Buffer.from(JSON.stringify({ pad: "x".repeat(6000) }));
    const inner = {
      method: "POST",
      path: "/api/tasks",
      contentType: "application/json",
      body,
    };
    try {
      const forged = sealAt(inner, { signKey: C.signKey }).envelope;
      const held = partial(mB, forged, forged.length - 10);
      await new Promise((r) => setTimeout(r, 50));
      expect((await post(mB, sealAt(inner).envelope)).status).toBe(200);
      expect(await held.response).toEqual({
        status: 401,
        text: "bad signature",
      });
      held.destroy();
    } finally {
      mB.deps.budget = saved;
    }
  });

  it("holds only so much envelope per proven sender, then says busy", async () => {
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
