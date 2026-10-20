import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import { fakeMachine } from "@/lib/__fixtures__/peer-machine";
import { edge, machine, type Machine } from "@/lib/__fixtures__/peer-rpc";
import { createHost, getHost, listRemoteHosts } from "@/lib/hosts";
import { helloRoute } from "./hello-route";
import { pinForMachine } from "./links";
import {
  acceptRequest,
  pendingRequests,
  receiveHello,
  receiveReveal,
  receiveStatus,
  resetIncoming,
  type PairingDeps,
} from "./pairing";
import {
  _live,
  httpsPost,
  poll,
  resetOutgoing,
  startLink,
  type OutDeps,
} from "./pairing-out";
import { pinPeer } from "./pin";

const A = fakeMachine("aaaa1111");
const B = fakeMachine("bbbb2222");
const listing = (m: typeof A, name: string) => ({
  id: m.machineId,
  name,
  hostname: m.hostname,
  signPub: m.signPub,
  lastSeenAt: null,
  version: null,
});

let mB: Machine;
beforeAll(async () => {
  mB = await machine(B, () => null);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  resetOutgoing();
  await mB.close();
});
beforeEach(() => {
  resetIncoming();
  resetOutgoing();
});

describe("pairing through the tunnel", () => {
  it("lets the hellos through without a token, and nothing else of linking", async () => {
    vi.stubGlobal("fetch", edge([mB]));
    for (const p of [
      "/api/peer/hello",
      "/api/peer/hello/reveal",
      "/api/peer/hello/status",
    ]) {
      const res = await fetch(`https://${B.hostname}${p}`, {
        method: "POST",
        body: "{}",
      });
      expect(res.status).toBe(200); // the fake Next behind the gate answered
      expect(mB.seen.at(-1)?.url).toBe(p);
    }
    for (const p of [
      "/api/peers/pending",
      "/api/peers/pending/x/accept",
      "/api/peers/link",
      "/api/peers/account",
    ]) {
      const res = await fetch(`https://${B.hostname}${p}`, {
        method: "POST",
        body: "{}",
      });
      expect(res.status).toBe(401);
    }
  });

  it("pairs over HTTP and pins each side's keys on a Connect host", async () => {
    const bDeps: PairingDeps = {
      identity: () => B,
      boxPub: () => B.box.publicRaw,
      listed: async (id) => (id === A.machineId ? listing(A, "Studio") : null),
      allowed: async () => true,
      pin: pinPeer,
      onRequest: () => {},
      onLinked: () => {},
      now: Date.now,
    };
    const routes: Record<string, ReturnType<typeof helloRoute>> = {
      "/api/peer/hello": helloRoute((b) => receiveHello(b, bDeps)),
      "/api/peer/hello/reveal": helloRoute((b) => receiveReveal(b, bDeps)),
      "/api/peer/hello/status": helloRoute((b) => receiveStatus(b, bDeps)),
    };
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", (async (url: string, init: RequestInit) => {
      seen.push(init);
      const u = new URL(url);
      expect(u.hostname).toBe(B.hostname);
      return routes[u.pathname](new NextRequest(url, init as never));
    }) as typeof fetch);
    // A name already taken here gets a suffix.
    createHost("Spark", "me@spark");
    const aDeps: OutDeps = {
      identity: () => A,
      boxPub: () => A.box.publicRaw,
      listed: async (id) => (id === B.machineId ? listing(B, "Spark") : null),
      allowed: async () => true,
      post: httpsPost,
      pin: pinPeer,
      onLinked: () => {},
      now: Date.now,
      pollMs: 1e9,
    };
    const out = await startLink(B.machineId, aDeps);
    expect(seen.every((i) => i.redirect === "error")).toBe(true);
    const [req] = pendingRequests();
    expect((await acceptRequest(req.id, out.code, bDeps)).ok).toBe(true);
    await poll(_live(out.id)!, A, aDeps);
    expect(_live(out.id)!.state).toBe("accepted");

    const onB = pinForMachine(A.machineId)!;
    const onA = pinForMachine(B.machineId)!;
    expect(onB).toMatchObject({
      signPub: A.signPub,
      boxPub: A.box.publicRaw,
      hostname: A.hostname,
      state: "active",
    });
    expect(onA).toMatchObject({
      signPub: B.signPub,
      boxPub: B.box.publicRaw,
      hostname: B.hostname,
      state: "active",
    });
    expect(getHost(onA.hostId)).toMatchObject({
      kind: "connect",
      name: "Spark (2)",
    });
    expect(getHost(onB.hostId)).toMatchObject({
      kind: "connect",
      name: "Studio",
    });

    // Pairing again keeps the same host and takes the new keys.
    const before = listRemoteHosts().length;
    const B2 = fakeMachine(B.machineId);
    pinPeer({
      id: B.machineId,
      name: "Spark",
      hostname: B.hostname,
      signPub: B2.signPub,
      boxPub: B2.box.publicRaw,
    });
    expect(listRemoteHosts()).toHaveLength(before);
    expect(pinForMachine(B.machineId)).toMatchObject({
      hostId: onA.hostId,
      signPub: B2.signPub,
    });
  });

  it("refuses to post anywhere but a Connect machine's name", async () => {
    await expect(
      httpsPost("169.254.169.254", "/api/peer/hello", {})
    ).rejects.toThrow(/Connect machine/);
  });
});
