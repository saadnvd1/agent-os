import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import crypto from "crypto";
import http from "http";
import type { AddressInfo } from "net";
import { listPeers, type PeerList } from "@/lib/connect/control-api";
import { startHeartbeat } from "@/lib/connect/heartbeat";
import {
  accountView,
  linkingAllowed,
  listedPeer,
  noteHeartbeat,
  rawFromSpki,
  setAccountFetcher,
} from "./account";
import { rawPublic } from "./keys";

const spki = () => {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    pem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    raw: rawPublic(publicKey),
  };
};
const host = () => `m-${crypto.randomBytes(8).toString("hex")}.runagentos.com`;

// A Connect service serving GET /machines/:id/peers as docs/machine-api.md has it.
let served: unknown;
let seen: http.IncomingHttpHeaders[] = [];
const control = http.createServer((req, res) => {
  seen.push(req.headers);
  if (req.method !== "GET" || req.url !== "/api/v1/machines/self0001/peers") {
    res.statusCode = 404;
    return res.end("{}");
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(served));
});
let apiUrl = "";
beforeAll(async () => {
  await new Promise<void>((r) => control.listen(0, "127.0.0.1", r));
  apiUrl = `http://127.0.0.1:${(control.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => control.close(r)));
afterEach(() => setAccountFetcher(null));

const machineKey = crypto
  .generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const config = () => ({ machineId: "self0001", hostname: host(), apiUrl });

describe("listPeers", () => {
  it("is a signed call, and drops what isn't a machine", async () => {
    const k = spki();
    served = {
      entitlements: { plan: "pro", link_machines: true, machine_limit: 10 },
      peers_etag: "abc123",
      peers: [
        {
          id: "peer0001",
          name: "Studio\u0007 Mac",
          hostname: host(),
          public_key: k.pem,
          last_seen_at: "2026-10-20T10:00:00Z",
          agent_os_version: "0.3.1",
        },
        { id: "self0001", name: "me", hostname: host(), public_key: k.pem },
        { id: "NOT-AN-ID", hostname: host(), public_key: k.pem },
        { id: "peer0002", hostname: host() },
        null,
      ],
    };
    seen = [];
    const list = await listPeers(config(), machineKey);
    expect(seen[0]["x-connect-machine"]).toBe("self0001");
    expect(seen[0]["x-connect-signature"]).toBeTruthy();
    expect(list.entitlements).toEqual({
      plan: "pro",
      linkMachines: true,
      machineLimit: 10,
    });
    expect(list.peersEtag).toBe("abc123");
    expect(list.peers.map((p) => [p.id, p.name])).toEqual([
      ["peer0001", "Studio  Mac"],
    ]);
  });

  it("refuses an answer with no list", async () => {
    served = { error: "nope" };
    await expect(listPeers(config(), machineKey)).rejects.toThrow(
      /no machine list/
    );
  });
});

describe("the account cache", () => {
  const listOf = (peers: PeerList["peers"], linkMachines = true): PeerList => ({
    entitlements: { plan: "pro", linkMachines, machineLimit: 10 },
    peersEtag: "e1",
    peers,
  });

  it("keeps only machines with an Ed25519 key and a Connect name", async () => {
    const good = spki();
    const x = crypto
      .generateKeyPairSync("x25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    setAccountFetcher(async () =>
      listOf([
        {
          id: "peer0001",
          name: "a",
          hostname: host(),
          publicKey: good.pem,
          lastSeenAt: null,
          version: null,
        },
        {
          id: "peer0002",
          name: "b",
          hostname: host(),
          publicKey: x,
          lastSeenAt: null,
          version: null,
        },
        {
          id: "peer0003",
          name: "c",
          hostname: "169.254.169.254",
          publicKey: good.pem,
          lastSeenAt: null,
          version: null,
        },
        {
          id: "peer0004",
          name: "d",
          hostname: "m-0.runagentos.com.evil.test",
          publicKey: good.pem,
          lastSeenAt: null,
          version: null,
        },
      ])
    );
    const view = await accountView();
    expect(view.peers.map((p) => p.id)).toEqual(["peer0001"]);
    expect(view.peers[0].signPub).toBe(good.raw);
    expect(rawFromSpki("not a key")).toBeNull();
  });

  it("fetches at most once a minute, and again when the etag changes", async () => {
    const k = spki();
    const fetcher = vi.fn(async () =>
      listOf([
        {
          id: "peer0001",
          name: "a",
          hostname: host(),
          publicKey: k.pem,
          lastSeenAt: null,
          version: null,
        },
      ])
    );
    setAccountFetcher(fetcher);
    await listedPeer("peer0001");
    await listedPeer("peer0001");
    await listedPeer("unknown1");
    expect(fetcher).toHaveBeenCalledTimes(1);
    noteHeartbeat({ enabled: true, peersEtag: "e1" });
    await accountView();
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ now: Date.now() + 10_000, toFake: ["Date"] });
    try {
      noteHeartbeat({ enabled: true, peersEtag: "e2" });
      await accountView();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the last list when the service can't be reached", async () => {
    const k = spki();
    let up = true;
    setAccountFetcher(async () => {
      if (!up) throw new Error("ECONNREFUSED");
      return listOf([
        {
          id: "peer0001",
          name: "a",
          hostname: host(),
          publicKey: k.pem,
          lastSeenAt: null,
          version: null,
        },
      ]);
    });
    await accountView();
    up = false;
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    try {
      const view = await accountView();
      expect(view.peers.map((p) => p.id)).toEqual(["peer0001"]);
      expect(view.error).toMatch(/Can't reach your AgentOS account/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says linking is off on a plan without it, and unknown before the service says", async () => {
    setAccountFetcher(async () => ({ peers: [] }));
    expect(await linkingAllowed()).toBeNull();
    noteHeartbeat({
      enabled: true,
      entitlements: { plan: "free", linkMachines: false, machineLimit: 1 },
    });
    expect(await linkingAllowed()).toBe(false);
    setAccountFetcher(async () => listOf([], true));
    expect(await linkingAllowed()).toBe(true);
  });
});

describe("the heartbeat", () => {
  it("hands every answer to onBeat, and survives it throwing", async () => {
    vi.useFakeTimers();
    try {
      const beats: unknown[] = [];
      const hb = startHeartbeat({
        beat: async () => ({ enabled: true, peersEtag: "e9" }),
        onBeat: (b) => {
          beats.push(b);
          throw new Error("boom");
        },
        onDisabled: () => {},
        onGone: () => {},
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(beats).toHaveLength(2);
      hb.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
