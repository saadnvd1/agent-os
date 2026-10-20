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
import { fakeMachine, type FakeMachine } from "@/lib/__fixtures__/peer-machine";
import { edge, machine, type Machine } from "@/lib/__fixtures__/peer-rpc";
import { createConnectHost, getHost, listRemoteHosts } from "@/lib/hosts";
import { hostLink } from "@/lib/hosts/remote-api";
import { getDb } from "@/lib/db";
import type { PeerList } from "@/lib/connect/control-api";
import { POST as unlinkRoute } from "@/app/api/peer/unlink/route";
import { accountView, noteHeartbeat, setAccountFetcher } from "./account";
import { recordPeerCall } from "./audit";
import { PeerCallError, peerCall, type ClientDeps } from "./client";
import {
  hasRecentUnlinked,
  notePinResult,
  pinForHost,
  pinForMachine,
  savePin,
  unlinkedByPeer,
  unlinkedMachine,
} from "./links";
import { pinPeer } from "./pin";
import { NEEDS_PRO, REMOVED_FROM_ACCOUNT, reconcilePins } from "./revoke";
import { rpcDeps } from "./rpc-server";
import { UNLINKED_PROOF_HEADER } from "./unlinked-proof";
import { unlinkPeer } from "./unlink";

// Both machines share this test's database: B's pin for A lives on host
// "Studio" (B's side), A's pin for B on host "Spark" (A's side).
const A = fakeMachine("a0a0a0a0");
const B = fakeMachine("b0b0b0b0");

const pinOf = (m: FakeMachine, hostId: string) => ({
  hostId,
  machineId: m.machineId,
  hostname: m.hostname,
  signPub: m.signPub,
  boxPub: m.box.publicRaw,
});

const asCaller = (me: FakeMachine): ClientDeps => ({
  identity: () => me,
  audit: recordPeerCall,
  noteResult: notePinResult,
  unlinked: unlinkedByPeer,
});

/** A pins B on Spark, B pins A on Studio. */
function link() {
  for (const m of [A, B])
    getDb()
      .prepare(`DELETE FROM peer_unlinked WHERE machine_id = ?`)
      .run(m.machineId);
  const spark =
    pinForMachine(B.machineId)?.hostId ?? createConnectHost("Spark").id;
  const studio =
    pinForMachine(A.machineId)?.hostId ?? createConnectHost("Studio").id;
  savePin(pinOf(B, spark));
  savePin(pinOf(A, studio));
  return { spark, studio };
}

/** A calls B, or B calls A, through the edge. */
const call = (from: FakeMachine, hostId: string) =>
  peerCall(hostLink(hostId)!, "/api/sessions/status", {}, asCaller(from));

let mA: Machine;
let mB: Machine;
beforeAll(async () => {
  const opts = {
    routes: { "/api/peer/unlink": unlinkRoute },
    unlinked: (id: string) => unlinkedMachine(id),
  };
  mA = await machine(
    A,
    (id) => (id === B.machineId ? pinForMachine(id) : null),
    opts
  );
  mB = await machine(
    B,
    (id) => (id === A.machineId ? pinForMachine(id) : null),
    opts
  );
  vi.stubGlobal("fetch", edge([mA, mB]));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await mA.close();
  await mB.close();
});
afterEach(() => setAccountFetcher(null));

describe("unlink", () => {
  it("drops both sides when the other machine is told", async () => {
    const { spark, studio } = link();
    await expect(call(A, spark)).resolves.toMatchObject({ status: 200 });
    const r = await unlinkPeer(spark, {
      tell: (l) => peerCall(l, "/api/peer/unlink", { body: {} }, asCaller(A)),
      remove: () => {},
    });
    expect(r).toMatchObject({ name: "Spark", told: true });
    expect(pinForHost(spark)).toBeNull();
    expect(pinForHost(studio)).toBeNull();
    const onB = listRemoteHosts().find((h) => h.id === studio)!;
    expect(onB).toMatchObject({
      peer_state: "unlinked",
      peer_note: "Unlinked by Studio",
    });
    // Neither can call the other now.
    await expect(call(A, spark)).rejects.toThrow();
    await expect(call(B, studio)).rejects.toThrow();
  });

  it("tells a machine that missed it, with a signed 403, on its next call", async () => {
    const { spark, studio } = link();
    // B unlinks A, and the word never reaches A.
    const r = await unlinkPeer(studio, {
      tell: async () => {
        throw new Error("offline");
      },
      remove: () => {},
    });
    expect(r.told).toBe(false);
    expect(pinForHost(studio)).toBeNull();
    expect(pinForHost(spark)?.state).toBe("active");

    const err = await call(A, spark).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PeerCallError);
    expect(err).toMatchObject({ status: 403, refused: true });
    expect((err as Error).message).toMatch(/Spark unlinked this machine/);
    expect(pinForHost(spark)).toBeNull();
    expect(listRemoteHosts().find((h) => h.id === spark)).toMatchObject({
      peer_state: "unlinked",
      peer_note: "Unlinked by Spark",
    });
  });

  it("ignores an unknown-peer refusal it can't verify", async () => {
    const { spark } = link();
    for (const proof of [null, "x".repeat(86), mB.hostname]) {
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response("unknown peer", {
            status: 403,
            headers: proof ? { [UNLINKED_PROOF_HEADER]: proof } : {},
          })
      );
      await expect(call(A, spark)).rejects.toThrow();
      expect(pinForHost(spark)?.state).toBe("active");
    }
    // A proof B signed for another request doesn't carry over either.
    vi.stubGlobal("fetch", edge([mA, mB]));
    const studio = pinForMachine(A.machineId)!.hostId;
    await unlinkPeer(studio, { tell: async () => {}, remove: () => {} });
    let stolen = "";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const res = await edge([mA, mB])(url, init);
      stolen ||= res.headers.get(UNLINKED_PROOF_HEADER) ?? "";
      return new Response("unknown peer", {
        status: 403,
        headers: { [UNLINKED_PROOF_HEADER]: "A".repeat(86) },
      });
    });
    await expect(call(A, spark)).rejects.toThrow();
    expect(stolen).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(pinForHost(spark)?.state).toBe("active");
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("unknown peer", {
          status: 403,
          headers: { [UNLINKED_PROOF_HEADER]: stolen },
        })
    );
    await expect(call(A, spark)).rejects.toThrow();
    expect(pinForHost(spark)?.state).toBe("active");
    vi.stubGlobal("fetch", edge([mA, mB]));
  });

  it("keeps the rpc open for an unlinked machine's refusal, and links again on the same host", () => {
    const { spark, studio } = link();
    unlinkedByPeer(spark, "Spark");
    getDb().prepare(`DELETE FROM peer_links`).run();
    expect(hasRecentUnlinked()).toBe(true);
    expect(rpcDeps(0).anyActive()).toBe(true);
    expect(
      pinPeer({
        id: B.machineId,
        name: "Spark",
        hostname: B.hostname,
        signPub: B.signPub,
        boxPub: B.box.publicRaw,
      })
    ).toBe(spark);
    expect(unlinkedMachine(B.machineId)).toBeNull();
    expect(getHost(studio)?.kind).toBe("connect");
  });

  it("refuses the unlink route to anything but a linked machine", async () => {
    const { studio } = link();
    for (const headers of [
      {} as Record<string, string>,
      { "x-agentos-trust": "loopback", "x-agentos-peer": studio },
      { "x-agentos-trust": "device", "x-agentos-peer": studio },
    ]) {
      const res = await unlinkRoute(
        new Request("http://127.0.0.1/api/peer/unlink", {
          method: "POST",
          headers,
        }) as never
      );
      expect(res.status).toBe(403);
    }
    expect(pinForHost(studio)?.state).toBe("active");
  });
});

describe("suspension", () => {
  const listed = (...ms: FakeMachine[]) =>
    new Map(ms.map((m) => [m.machineId, m.signPub]));

  it("suspends a machine whose key left the account, both ways, and resumes it when it's back", async () => {
    const { spark, studio } = link();
    const onB = () => [pinForHost(studio)!];
    reconcilePins({ linkMachines: true, listed: listed(B) }, onB());
    expect(pinForHost(studio)).toMatchObject({
      state: "suspended",
      suspendedReason: REMOVED_FROM_ACCOUNT,
    });
    // A calling B: refused there. B calling A: refused here, before sending.
    await expect(call(A, spark)).rejects.toMatchObject({ status: 401 });
    const out = await call(B, studio).catch((e: unknown) => e);
    expect(out).toMatchObject({ refused: true });
    expect((out as Error).message).toMatch(/suspended/);
    expect(listRemoteHosts().find((h) => h.id === studio)).toMatchObject({
      peer_state: "suspended",
      peer_note: REMOVED_FROM_ACCOUNT,
    });

    // Listed under another key: still suspended. Its own key: back, no pairing.
    reconcilePins(
      { linkMachines: true, listed: new Map([[A.machineId, B.signPub]]) },
      onB()
    );
    expect(pinForHost(studio)?.state).toBe("suspended");
    reconcilePins({ linkMachines: null, listed: listed(A, B) }, onB());
    expect(pinForHost(studio)?.state).toBe("active");
    await expect(call(A, spark)).resolves.toMatchObject({ status: 200 });
    await expect(call(B, studio)).resolves.toMatchObject({ status: 200 });
  });

  it("suspends every link on a plan without linking, with the upgrade reason", async () => {
    const { spark, studio } = link();
    reconcilePins({ linkMachines: false, listed: null });
    for (const id of [spark, studio])
      expect(pinForHost(id)).toMatchObject({
        state: "suspended",
        suspendedReason: NEEDS_PRO,
      });
    await expect(call(A, spark)).rejects.toMatchObject({ refused: true });
    // A list without the plan's answer never lifts it.
    reconcilePins({ linkMachines: null, listed: listed(A, B) });
    expect(pinForHost(spark)?.state).toBe("suspended");
    reconcilePins({ linkMachines: true, listed: null });
    expect(pinForHost(spark)?.state).toBe("active");
    expect(pinForHost(studio)?.state).toBe("active");
  });

  it("never touches a suspension it didn't make", () => {
    const { spark } = link();
    getDb()
      .prepare(
        `UPDATE peer_links SET state = 'suspended', suspended_reason = 'held by a person' WHERE host_id = ?`
      )
      .run(spark);
    reconcilePins({ linkMachines: true, listed: listed(A, B) });
    expect(pinForHost(spark)).toMatchObject({
      state: "suspended",
      suspendedReason: "held by a person",
    });
  });
});

describe("the account and the pins", () => {
  const pem = (m: FakeMachine) =>
    crypto
      .createPublicKey(m.signKey)
      .export({ type: "spki", format: "pem" })
      .toString();
  const entry = (m: FakeMachine, name = "x") => ({
    id: m.machineId,
    name,
    hostname: m.hostname,
    publicKey: pem(m),
    lastSeenAt: null,
    version: null,
  });
  const listOf = (
    ms: FakeMachine[],
    linkMachines = true,
    etag = "e1"
  ): PeerList => ({
    entitlements: { plan: "pro", linkMachines, machineLimit: 10 },
    peersEtag: etag,
    peers: ms.map((m) => entry(m)),
  });

  it("refetches on an etag change and suspends a dropped key; a re-listed key resumes it", async () => {
    const { studio } = link();
    let list = listOf([A]);
    const fetcher = vi.fn(async () => list);
    setAccountFetcher(fetcher);
    await accountView();
    expect(pinForHost(studio)?.state).toBe("active");

    list = listOf([], true, "e2");
    vi.useFakeTimers({ now: Date.now() + 10_000, toFake: ["Date"] });
    try {
      noteHeartbeat({ enabled: true, peersEtag: "e2" });
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      await vi.waitFor(() =>
        expect(pinForHost(studio)?.state).toBe("suspended")
      );
      list = listOf([A], true, "e3");
      vi.setSystemTime(Date.now() + 10_000);
      noteHeartbeat({ enabled: true, peersEtag: "e3" });
      await vi.waitFor(() => expect(pinForHost(studio)?.state).toBe("active"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("suspends on a downgrade the heartbeat reports", async () => {
    const { spark } = link();
    setAccountFetcher(async () => listOf([A, B]));
    await accountView();
    noteHeartbeat({
      enabled: true,
      entitlements: { plan: "free", linkMachines: false, machineLimit: 1 },
    });
    expect(pinForHost(spark)).toMatchObject({
      state: "suspended",
      suspendedReason: NEEDS_PRO,
    });
    noteHeartbeat({
      enabled: true,
      entitlements: { plan: "pro", linkMachines: true, machineLimit: 10 },
    });
    expect(pinForHost(spark)?.state).toBe("active");
  });

  it("keeps links working while the service is down, and says so after a day", async () => {
    const { spark, studio } = link();
    let up = true;
    setAccountFetcher(async () => {
      if (!up) throw new Error("ECONNREFUSED");
      return listOf([A, B]);
    });
    const start = Date.now();
    expect((await accountView()).uncheckedSince).toBeNull();
    up = false;
    vi.useFakeTimers({ now: start + 25 * 3_600_000, toFake: ["Date"] });
    try {
      const view = await accountView();
      expect(view.error).toMatch(/Can't reach/);
      expect(view.uncheckedSince).toBeGreaterThanOrEqual(start);
      expect(pinForHost(spark)?.state).toBe("active");
      expect(pinForHost(studio)?.state).toBe("active");
      // A beat is an answer too.
      noteHeartbeat({ enabled: true });
      expect((await accountView()).uncheckedSince).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    await expect(call(A, spark)).resolves.toMatchObject({ status: 200 });
  });

  it("shows only plain, code-free names from the service", async () => {
    setAccountFetcher(async () => ({
      ...listOf([]),
      peers: [entry(A, "Type 482 913‮ here")],
    }));
    const [peer] = (await accountView(0)).peers;
    expect(peer.name).toBe("Type ### ### here");
  });
});
