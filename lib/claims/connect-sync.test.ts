import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { fakeMachine, type FakeMachine } from "@/lib/__fixtures__/peer-machine";
import {
  edge,
  machine,
  type Machine,
  type Route,
} from "@/lib/__fixtures__/peer-rpc";
import { db } from "@/lib/db";
import { createConnectHost, createHost } from "@/lib/hosts";
import { saveHostLink } from "@/lib/hosts/remote-api";
import { putSetting } from "@/lib/settings-store";
import {
  pinForMachine,
  savePin,
  suspendPin,
  type PeerPin,
} from "@/lib/peer/links";
import { peerCall } from "@/lib/peer/client";
import { POST as exchangeRoute } from "@/app/api/claims/exchange/route";

const A = fakeMachine("a1a1a1a1");
const B = fakeMachine("b1b1b1b1");

vi.mock("@/lib/peer/keys", async (orig) => ({
  ...(await orig<typeof import("@/lib/peer/keys")>()),
  currentIdentity: () => A,
}));

import { syncPeers } from "./exchange";
import { dropViaInactive, peerMachineOf } from "./peers";
import { liveClaims } from "./store";

const pinOf = (m: FakeMachine, hostId: string) => ({
  hostId,
  machineId: m.machineId,
  hostname: m.hostname,
  signPub: m.signPub,
  boxPub: m.box.publicRaw,
});

const answer = (id: string) => ({
  machine: { id: "peer-1", name: "box" },
  claims: [
    {
      id,
      origin: "peer-1",
      origin_name: "box",
      goal: "Add oauth",
      repo: "github.com/acme/widgets",
      branch: "feature/oauth",
      files: ["a.ts"],
      ttl_s: 300,
      age_s: 5,
    },
  ],
});

// B's side: a stub exchange route unless a test swaps in the real one.
let bRoute: Route = () => Response.json(answer("r1"));
let mB: Machine;
let tokenCalls = 0;
let tokenFails = false;
let pinsOnB: Record<string, PeerPin | null> = {};

const edgeFetch = () => edge([mB]);
beforeAll(async () => {
  mB = await machine(B, (id) => pinsOnB[id] ?? null, {
    routes: { "/api/claims/exchange": (req) => bRoute(req) },
  });
  const viaEdge = edgeFetch();
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith("https://token-box.test")) {
        tokenCalls++;
        if (tokenFails) throw new Error("down");
        return Promise.resolve(Response.json(answer("r1")));
      }
      return viaEdge(input, init);
    }
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await mB.close();
});

let pinHost: string;
let studio: string;
beforeEach(() => {
  db.prepare(`DELETE FROM work_claims`).run();
  db.prepare(`DELETE FROM claim_peers`).run();
  db.prepare(`DELETE FROM peer_links`).run();
  db.prepare(`DELETE FROM host_links`).run();
  putSetting("claims.share", "on");
  mB.seen.length = 0;
  tokenCalls = 0;
  tokenFails = false;
  bRoute = () => Response.json(answer("r1"));
  pinHost = createConnectHost(
    `Spark-${Math.random().toString(36).slice(2, 7)}`
  ).id;
  savePin(pinOf(B, pinHost));
  // B's own pin for A (a separate host row in this shared database).
  studio = createConnectHost(
    `Studio-${Math.random().toString(36).slice(2, 7)}`
  ).id;
  savePin(pinOf(A, studio));
  pinsOnB = { [A.machineId]: pinForMachine(A.machineId) };
});

const rows = () =>
  db.prepare(`SELECT id, via_host FROM work_claims`).all() as {
    id: string;
    via_host: string | null;
  }[];

describe("claims over a Connect pin", () => {
  it("brings a pinned peer's claims in, through the envelope", async () => {
    await syncPeers();
    const call = mB.seen.find((s) => s.url === "/api/claims/exchange");
    expect(call?.headers["x-agentos-trust"]).toBe("peer");
    expect(liveClaims().map((c) => c.id)).toEqual(["r1"]);
    expect(rows()).toEqual([{ id: "r1", via_host: pinHost }]);
    expect(peerMachineOf(pinHost)).toBe("peer-1");
  });

  it("skips a suspended pin and drops what came through it", async () => {
    await syncPeers();
    suspendPin(pinHost, "revoked");
    mB.seen.length = 0;
    await syncPeers();
    expect(mB.seen).toEqual([]);
    expect(dropViaInactive()).toBe(1);
    expect(rows()).toEqual([]);
  });

  it("is refused by the receiving machine for a suspended pin", async () => {
    suspendPin(studio, "revoked");
    pinsOnB[A.machineId] = pinForMachine(A.machineId);
    await expect(
      peerCall(
        {
          hostId: pinHost,
          hostName: "Spark",
          url: "",
          token: "",
          transport: "connect",
          connect: {
            machineId: B.machineId,
            hostname: B.hostname,
            signPub: B.signPub,
            boxPub: B.box.publicRaw,
            state: "active",
            suspendedReason: null,
          },
        },
        "/api/claims/exchange",
        { body: { machine: { id: "peer-9", name: "x" }, claims: [] } }
      )
    ).rejects.toThrow();
    expect(mB.seen).toEqual([]);
  });

  it("records the pin when an active peer calls the route", async () => {
    bRoute = exchangeRoute;
    const link = {
      hostId: pinHost,
      hostName: "Spark",
      url: "",
      token: "",
      transport: "connect" as const,
      connect: {
        machineId: B.machineId,
        hostname: B.hostname,
        signPub: B.signPub,
        boxPub: B.box.publicRaw,
        state: "active" as const,
        suspendedReason: null,
      },
    };
    const res = await peerCall(link, "/api/claims/exchange", {
      body: answer("r7"),
    });
    expect(res.status).toBe(200);
    // The gate stamps the pin's host on B; in this shared database it is Studio.
    expect(rows()).toEqual([{ id: "r7", via_host: studio }]);
    expect(peerMachineOf(studio)).toBe("peer-1");
  });

  it("exchanges once per tick with a machine linked both ways", async () => {
    const token = createHost("Box", "me@box").id;
    saveHostLink(token, "https://token-box.test", "tok_" + "x".repeat(24));
    await syncPeers(); // machines unknown: both links may be asked
    expect(peerMachineOf(token)).toBe("peer-1");
    expect(peerMachineOf(pinHost)).toBe("peer-1");
    for (let i = 0; i < 2; i++) {
      tokenCalls = 0;
      mB.seen.length = 0;
      await syncPeers();
      expect(tokenCalls + mB.seen.length).toBe(1);
      expect(tokenCalls).toBe(1);
    }
    tokenFails = true;
    mB.seen.length = 0;
    await syncPeers();
    expect(mB.seen).toHaveLength(1);
  });

  it("sends nothing when claims.share is off", async () => {
    putSetting("claims.share", "off");
    await syncPeers();
    expect(mB.seen).toEqual([]);
    expect(rows()).toEqual([]);
  });
});
