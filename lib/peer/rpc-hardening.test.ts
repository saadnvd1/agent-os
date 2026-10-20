import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { IncomingMessage } from "http";
import { fakeMachine, writeConnectDir } from "@/lib/__fixtures__/peer-machine";
import {
  edge,
  machine,
  outcomesOf,
  partial,
  post,
  type Machine,
} from "@/lib/__fixtures__/peer-rpc";
import { createConnectHost } from "@/lib/hosts";
import { getDb } from "@/lib/db";
import { markTunnelSocket } from "@/lib/security/auth";
import { resetAuditLimits } from "./audit";
import { sealRequest } from "./envelope";
import { boxPublic } from "./keys";
import { pinForHost, savePin } from "./links";
import { DEFAULT_PACE, ipv6Prefix64, sourceOf } from "./rpc-intake";

const A = fakeMachine("aaaa1111");
const B = fakeMachine("bbbb2222");
process.env.AGENTOS_CONNECT_DIR = writeConnectDir(A);

let mB: Machine;
let hostA: string;

beforeAll(async () => {
  hostA = createConnectHost("mac-a").id;
  savePin({
    hostId: hostA,
    machineId: A.machineId,
    hostname: A.hostname,
    signPub: A.signPub,
    boxPub: A.box.publicRaw,
  });
  mB = await machine(B, (id) =>
    id === A.machineId ? pinForHost(hostA) : null
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await mB.close();
});

beforeEach(() => {
  vi.stubGlobal("fetch", edge([mB]));
  resetAuditLimits();
  getDb().prepare(`DELETE FROM peer_audit`).run();
});

const seal = (pad = 0) =>
  sealRequest({
    from: A.machineId,
    to: B.machineId,
    signKey: A.signKey,
    peerBox: boxPublic(B.box.publicRaw),
    request: {
      method: "POST",
      path: "/api/tasks",
      query: "",
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ pad: "x".repeat(pad) })),
    },
  }).envelope;

describe("rpc intake hardening", () => {
  it("answers busy, and stays up, when looking up the sender throws", async () => {
    const saved = mB.deps.pinForMachine;
    mB.deps.pinForMachine = () => {
      throw new Error("SQLITE_BUSY");
    };
    try {
      expect(await post(mB, seal())).toEqual({ status: 429, text: "busy" });
    } finally {
      mB.deps.pinForMachine = saved;
    }
    // The server is still there, and the request's share was given back.
    expect((await post(mB, seal())).status).toBe(200);
  });

  it("spends a nonce when its header is proven, so a copy can't ride along", async () => {
    const env = seal(6000);
    const first = partial(mB, env, 2000);
    await new Promise((r) => setTimeout(r, 50));
    // Someone who saw the header resends it while the body is still coming.
    expect(await post(mB, env)).toEqual({ status: 401, text: "replay" });
    first.finish();
    expect((await first.response).status).toBe(200);
    // ...and after it has completed.
    expect(await post(mB, env)).toEqual({ status: 401, text: "replay" });
    expect(outcomesOf("/api/peer/rpc")).toEqual(["replay", "replay"]);
  });

  it("drops a sender that holds back its header", async () => {
    const saved = mB.deps.pace;
    mB.deps.pace = { ...DEFAULT_PACE, headerMs: 150 };
    try {
      const p = partial(mB, seal(), 3);
      expect(await p.within(1500)).toBe("answered");
      expect(await p.response).toEqual({ status: 408, text: "too slow" });
      p.destroy();
    } finally {
      mB.deps.pace = saved;
    }
    expect(DEFAULT_PACE.headerMs).toBeLessThan(DEFAULT_PACE.graceMs);
  });
});

describe("sourceOf", () => {
  const req = (cf: string, tunnel = true) => {
    const socket = { remoteAddress: "127.0.0.1" };
    if (tunnel) markTunnelSocket(socket);
    return {
      socket,
      headers: { "cf-connecting-ip": cf },
    } as unknown as IncomingMessage;
  };

  it("counts IPv6 visitors by their /64", () => {
    expect(sourceOf(req("2001:db8:1:2::1"))).toBe(
      sourceOf(req("2001:db8:1:2:ffff:ffff:ffff:ffff"))
    );
    expect(sourceOf(req("2001:db8:1:2::1"))).not.toBe(
      sourceOf(req("2001:db8:1:3::1"))
    );
    expect(sourceOf(req("203.0.113.9"))).toBe("203.0.113.9");
  });

  it("only believes cf-connecting-ip on a tunnel socket", () => {
    expect(sourceOf(req("203.0.113.9", false))).toBe("127.0.0.1");
  });

  it("expands every way of writing the same /64", () => {
    const want = "2001:db8:0:2::/64";
    for (const a of [
      "2001:db8:0:2:0:0:0:1",
      "2001:0db8:0000:0002::",
      "2001:DB8:0:2:1:2:3:4",
      "2001:db8:0:2::1%eth0",
    ])
      expect(ipv6Prefix64(a)).toBe(want);
    expect(ipv6Prefix64("::1")).toBe("0:0:0:0::/64");
    expect(ipv6Prefix64("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });
});
