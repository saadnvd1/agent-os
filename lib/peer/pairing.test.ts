import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeMachine, type FakeMachine } from "@/lib/__fixtures__/peer-machine";
import type { AccountPeer } from "./account";
import {
  commitTo,
  randomNonce,
  signHello,
  signReveal,
  type Hello,
} from "./hello";
import {
  MAX_OPEN,
  REQUEST_TTL_MS,
  acceptRequest,
  declineRequest,
  pendingRequests,
  receiveHello,
  receiveReveal,
  receiveStatus,
  resetIncoming,
  type PairingDeps,
} from "./pairing";
import {
  _live,
  poll,
  resetOutgoing,
  startLink,
  type OutDeps,
  type Post,
} from "./pairing-out";

const A = fakeMachine("aaaa1111");
const B = fakeMachine("bbbb2222");
const M = fakeMachine("eeee9999"); // whoever sits in the middle

const listing = (m: FakeMachine, as?: FakeMachine): AccountPeer => ({
  id: m.machineId,
  name: `machine ${m.machineId}`,
  hostname: m.hostname,
  signPub: (as ?? m).signPub,
  lastSeenAt: null,
  version: null,
});

let clock = 1_800_000_000_000;
let pinnedOnB: { id: string; signPub: string; boxPub: string }[];
let pinnedOnA: { id: string; signPub: string; boxPub: string }[];
let requestsOnB: string[];

/** B's side, with the account list it believes. */
const bDeps = (
  o: { me?: FakeMachine; list?: AccountPeer[]; allowed?: boolean | null } = {}
): PairingDeps => {
  const me = o.me ?? B;
  const list = o.list ?? [listing(A)];
  return {
    identity: () => me,
    boxPub: () => me.box.publicRaw,
    listed: async (id) => list.find((p) => p.id === id) ?? null,
    allowed: async () => (o.allowed === undefined ? true : o.allowed),
    pin: (p) => {
      pinnedOnB.push({ id: p.id, signPub: p.signPub, boxPub: p.boxPub });
      return `host-${p.id}`;
    },
    onRequest: (name) => requestsOnB.push(name),
    onLinked: () => {},
    now: () => clock,
  };
};

/** Routes A's posts to B's handlers, as the edge would. */
const toB =
  (deps: PairingDeps): Post =>
  async (_host, path, body) => {
    const r =
      path === "/api/peer/hello"
        ? await receiveHello(JSON.parse(JSON.stringify(body)), deps)
        : path === "/api/peer/hello/reveal"
          ? receiveReveal(JSON.parse(JSON.stringify(body)), deps)
          : receiveStatus(JSON.parse(JSON.stringify(body)), deps);
    return { status: r.status, json: r.body };
  };

const aDeps = (
  o: {
    me?: FakeMachine;
    list?: AccountPeer[];
    post?: Post;
    allowed?: boolean;
  } = {}
): OutDeps => {
  const me = o.me ?? A;
  const list = o.list ?? [listing(B)];
  return {
    identity: () => me,
    boxPub: () => me.box.publicRaw,
    listed: async (id) => list.find((p) => p.id === id) ?? null,
    allowed: async () => o.allowed ?? true,
    post: o.post ?? toB(bDeps()),
    pin: (p) => {
      pinnedOnA.push({ id: p.id, signPub: p.signPub, boxPub: p.boxPub });
      return `host-${p.id}`;
    },
    onLinked: () => {},
    now: () => clock,
    pollMs: 1e9,
  };
};

const helloFrom = (
  m: FakeMachine,
  o: { to?: FakeMachine; aNonce?: string; ts?: number } = {}
): { hello: Hello; aNonce: string } => {
  const aNonce = o.aNonce ?? randomNonce(32);
  return {
    aNonce,
    hello: signHello(m.signKey, {
      from: m.machineId,
      to: (o.to ?? B).machineId,
      ts: o.ts ?? clock,
      nonce: randomNonce(16),
      sign_pub: m.signPub,
      box_pub: m.box.publicRaw,
      commit: commitTo(m.box.publicRaw, m.signPub, aNonce),
    }),
  };
};

const revealFor = (m: FakeMachine, requestId: string, aNonce: string) =>
  signReveal(m.signKey, {
    from: m.machineId,
    to: B.machineId,
    ts: clock,
    nonce: randomNonce(16),
    request_id: requestId,
    a_nonce: aNonce,
  });

beforeEach(() => {
  resetIncoming();
  resetOutgoing();
  pinnedOnA = [];
  pinnedOnB = [];
  requestsOnB = [];
  clock += 60 * 60_000;
});
afterEach(() => resetOutgoing());

describe("pairing", () => {
  it("links both ways once the code shown on A is typed on B", async () => {
    const out = await startLink(B.machineId, aDeps());
    expect(out.code).toMatch(/^\d{6}$/);
    expect(requestsOnB).toEqual([`machine ${A.machineId}`]);
    const [req] = pendingRequests(clock);
    expect(req).toMatchObject({ machineId: A.machineId, attemptsLeft: 3 });

    expect(
      await acceptRequest(
        req.id,
        `${out.code.slice(0, 3)} ${out.code.slice(3)}`,
        bDeps()
      )
    ).toMatchObject({ ok: true });
    expect(pinnedOnB).toEqual([
      { id: A.machineId, signPub: A.signPub, boxPub: A.box.publicRaw },
    ]);
    // A pins B only when B says so, signed.
    expect(pinnedOnA).toEqual([]);
    await poll(_live(out.id)!, A, aDeps());
    expect(_live(out.id)!.state).toBe("accepted");
    expect(pinnedOnA).toEqual([
      { id: B.machineId, signPub: B.signPub, boxPub: B.box.publicRaw },
    ]);
  });

  it("refuses a hello from a key the account doesn't list, before anything shows", async () => {
    const { hello } = helloFrom(M);
    const r = await receiveHello(hello, bDeps());
    expect(r).toMatchObject({ status: 403 });
    // A's id, but not the key the account lists for A.
    const forged = signHello(M.signKey, {
      ...helloFrom(A).hello,
      sign_pub: M.signPub,
      box_pub: M.box.publicRaw,
    });
    expect(await receiveHello(forged, bDeps())).toMatchObject({ status: 403 });
    expect(pendingRequests(clock)).toEqual([]);
    expect(requestsOnB).toEqual([]);
  });

  it("refuses a hello whose signature isn't the listed key's", async () => {
    const { hello } = helloFrom(A);
    const bad = {
      ...hello,
      commit: commitTo(A.box.publicRaw, A.signPub, randomNonce(32)),
    };
    expect(await receiveHello(bad, bDeps())).toMatchObject({ status: 401 });
  });

  it("refuses a replayed hello, and a stale one", async () => {
    const { hello } = helloFrom(A);
    expect((await receiveHello(hello, bDeps())).status).toBe(200);
    expect(await receiveHello(hello, bDeps())).toMatchObject({
      status: 401,
      body: { error: "replay" },
    });
    const old = helloFrom(A, { ts: clock - 121_000 }).hello;
    expect((await receiveHello(old, bDeps())).status).toBe(401);
    // A hello addressed to another machine.
    expect(
      (await receiveHello(helloFrom(A, { to: M }).hello, bDeps())).status
    ).toBe(403);
  });

  it("voids a request whose reveal doesn't match the commitment", async () => {
    const { hello } = helloFrom(A);
    const ack = (await receiveHello(hello, bDeps())).body as {
      request_id: string;
    };
    const other = randomNonce(32);
    expect(
      receiveReveal(revealFor(A, ack.request_id, other), bDeps())
    ).toMatchObject({ status: 403 });
    expect(pendingRequests(clock)).toEqual([]);
    expect(requestsOnB).toEqual([]);
  });

  it("refuses a reveal signed by anyone but the hello's sender", async () => {
    const { hello, aNonce } = helloFrom(A);
    const ack = (await receiveHello(hello, bDeps())).body as {
      request_id: string;
    };
    const r = revealFor(M, ack.request_id, aNonce);
    expect(receiveReveal({ ...r, from: A.machineId }, bDeps()).status).toBe(
      401
    );
  });

  it("gives a key-substituting middle a different code on each side", async () => {
    // Control lies to both: to A it lists M's key for B, to B M's key for A.
    // M answers A as "B", with its own keys...
    const onA = await startLink(
      B.machineId,
      aDeps({
        list: [listing(B, M)],
        post: toB(bDeps({ me: { ...M, machineId: B.machineId } })),
      })
    );
    resetIncoming(); // that request lived on M, not on B
    // ...and asks the real B as "A", with its own keys.
    const realB = bDeps({ list: [listing(A, M)] });
    const viaM = await startLink(
      B.machineId,
      aDeps({ me: { ...M, machineId: A.machineId }, post: toB(realB) })
    );
    const [req] = pendingRequests(clock);
    expect(viaM.code).not.toBe(onA.code);
    // The person types A's code on B: it doesn't match, and nothing is pinned.
    expect(await acceptRequest(req.id, onA.code, realB)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(pinnedOnB).toEqual([]);
  });

  it("voids a request after three wrong codes", async () => {
    const out = await startLink(B.machineId, aDeps());
    const [req] = pendingRequests(clock);
    const wrong = out.code === "000000" ? "111111" : "000000";
    expect(await acceptRequest(req.id, wrong, bDeps())).toMatchObject({
      ok: false,
      attemptsLeft: 2,
    });
    expect(await acceptRequest(req.id, wrong, bDeps())).toMatchObject({
      ok: false,
      attemptsLeft: 1,
    });
    expect(await acceptRequest(req.id, wrong, bDeps())).toMatchObject({
      ok: false,
      attemptsLeft: 0,
    });
    expect(await acceptRequest(req.id, out.code, bDeps())).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(pinnedOnB).toEqual([]);
    await poll(_live(out.id)!, A, aDeps());
    expect(_live(out.id)!.state).toBe("declined");
    expect(pinnedOnA).toEqual([]);
  });

  it("expires a request after five minutes on both sides", async () => {
    const out = await startLink(B.machineId, aDeps());
    const [req] = pendingRequests(clock);
    clock += REQUEST_TTL_MS + 1;
    expect(pendingRequests(clock)).toEqual([]);
    expect(await acceptRequest(req.id, out.code, bDeps())).toMatchObject({
      status: 404,
    });
    await poll(_live(out.id)!, A, aDeps());
    expect(_live(out.id)!.state).toBe("expired");
  });

  it("declining on B ends it on A", async () => {
    const out = await startLink(B.machineId, aDeps());
    expect(declineRequest(pendingRequests(clock)[0].id)).toBe(true);
    await poll(_live(out.id)!, A, aDeps());
    expect(_live(out.id)!.state).toBe("declined");
  });

  it("holds at most three requests open", async () => {
    const machines = ["aaaa0001", "aaaa0002", "aaaa0003", "aaaa0004"].map(
      fakeMachine
    );
    const deps = bDeps({ list: machines.map((m) => listing(m)) });
    for (const m of machines.slice(0, MAX_OPEN))
      expect((await receiveHello(helloFrom(m).hello, deps)).status).toBe(200);
    expect(
      await receiveHello(helloFrom(machines[3]).hello, deps)
    ).toMatchObject({ status: 429 });
  });

  it("takes five hellos per sender and twenty in all per ten minutes", async () => {
    const deps = bDeps();
    const decline = (r: { body: Record<string, unknown> }) =>
      declineRequest(String(r.body.request_id));
    for (let i = 0; i < 5; i++) {
      const r = await receiveHello(helloFrom(A).hello, deps);
      expect(r.status).toBe(200);
      decline(r);
    }
    expect((await receiveHello(helloFrom(A).hello, deps)).status).toBe(429);

    resetIncoming();
    const many = Array.from({ length: 5 }, (_, i) =>
      fakeMachine(`cccc000${i}`)
    );
    const all = bDeps({ list: many.map((m) => listing(m)) });
    let ok = 0;
    for (const m of many)
      for (let i = 0; i < 4; i++) {
        const r = await receiveHello(helloFrom(m).hello, all);
        if (r.status === 200) ok++;
        decline(r);
      }
    expect(ok).toBe(20);
    const late = fakeMachine("cccc0099");
    const r = await receiveHello(
      helloFrom(late).hello,
      bDeps({ list: [listing(late)] })
    );
    expect(r.status).toBe(429);
    clock += 10 * 60_000 + 1;
    expect((await receiveHello(helloFrom(A).hello, deps)).status).toBe(200);
  });

  it("refuses linking without the plan, on both sides", async () => {
    expect(
      await receiveHello(helloFrom(A).hello, bDeps({ allowed: false }))
    ).toMatchObject({ status: 402 });
    expect(
      await receiveHello(helloFrom(A).hello, bDeps({ allowed: null }))
    ).toMatchObject({ status: 402 });
    await expect(
      startLink(B.machineId, aDeps({ allowed: false }))
    ).rejects.toMatchObject({ status: 402 });
    // ...and if the plan lapses before the code is typed.
    const out = await startLink(B.machineId, aDeps());
    const [req] = pendingRequests(clock);
    expect(
      await acceptRequest(req.id, out.code, bDeps({ allowed: false }))
    ).toMatchObject({ status: 402 });
    expect(pinnedOnB).toEqual([]);
  });

  it("refuses an answer from B signed by a key the account doesn't list", async () => {
    const impostor = bDeps({ me: { ...M, machineId: B.machineId } });
    await expect(
      startLink(B.machineId, aDeps({ post: toB(impostor) }))
    ).rejects.toThrow(/wrong key/);
  });

  it("ignores an 'accepted' that isn't signed by B for this call", async () => {
    const out = await startLink(B.machineId, aDeps());
    const live = _live(out.id)!;
    // Whoever is on the path answers "accepted" itself, or replays one.
    const forged: Post = async (host, path, body) => {
      const real = await toB(bDeps())(host, path, body);
      const json = real.json as { state: string; sig: string };
      return { status: 200, json: { ...json, state: "accepted" } };
    };
    await poll(live, A, aDeps({ post: forged }));
    expect(live.state).toBe("pending");
    expect(pinnedOnA).toEqual([]);
  });

  it("refuses an unknown request id and a status call from another machine", async () => {
    const out = await startLink(B.machineId, aDeps());
    const live = _live(out.id)!;
    const id = live.requestId;
    const fromM = await toB(bDeps({ list: [listing(A), listing(M)] }))(
      B.hostname,
      "/api/peer/hello/status",
      {
        v: 1,
        from: M.machineId,
        to: B.machineId,
        ts: clock,
        nonce: randomNonce(16),
        request_id: id,
        sig: "x".repeat(86),
      }
    );
    expect(fromM.status).toBe(404);
  });
});
