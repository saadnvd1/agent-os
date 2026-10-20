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
  confirmLink,
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

/** Typed on B: the code A shows. Returns the code B shows back. */
async function acceptOnB(code: string, deps = bDeps()) {
  const req = pendingRequests(clock).find((r) => r.state === "pending")!;
  const r = await acceptRequest(req.id, code, deps);
  if (!r.ok) throw new Error(r.error);
  return r.confirmCode;
}

const otherThan = (code: string) => (code === "000000" ? "111111" : "000000");

describe("pairing", () => {
  it("links both ways: A's code typed on B, then B's code typed on A", async () => {
    const out = await startLink(B.machineId, aDeps());
    expect(out.code).toMatch(/^\d{6}$/);
    expect(requestsOnB).toEqual([`machine ${A.machineId}`]);
    const [req] = pendingRequests(clock);
    expect(req).toMatchObject({
      machineId: A.machineId,
      lastSeenAt: null,
      attemptsLeft: 3,
    });

    const back = await acceptOnB(
      `${out.code.slice(0, 3)} ${out.code.slice(3)}`
    );
    expect(back).toMatch(/^\d{6}$/);
    expect(back).not.toBe(out.code);
    expect(pinnedOnB).toEqual([
      { id: A.machineId, signPub: A.signPub, boxPub: A.box.publicRaw },
    ]);
    // B's signed "accepted" alone pins nothing on A.
    await poll(_live(out.id)!, A, aDeps());
    expect(_live(out.id)!.state).toBe("confirm");
    expect(pinnedOnA).toEqual([]);
    // A's own code typed back doesn't do it either.
    expect(confirmLink(out.id, out.code, aDeps())).toMatchObject({
      ok: false,
      attemptsLeft: 2,
    });
    expect(confirmLink(out.id, back, aDeps())).toMatchObject({ ok: true });
    expect(_live(out.id)!.state).toBe("accepted");
    expect(pinnedOnA).toEqual([
      { id: B.machineId, signPub: B.signPub, boxPub: B.box.publicRaw },
    ]);
  });

  it("pins nothing on A for a control plane that lists its own key for B", async () => {
    // To A, control lists M's key (and a name M answers on) as B's. M plays
    // B, knows every input, so it "accepts" its own request and says so.
    const asB = bDeps({ me: { ...M, machineId: B.machineId } });
    const out = await startLink(
      B.machineId,
      aDeps({ list: [listing(B, M)], post: toB(asB) })
    );
    await acceptOnB(out.code, asB);
    pinnedOnB = []; // that pin was on M
    await poll(
      _live(out.id)!,
      A,
      aDeps({ list: [listing(B, M)], post: toB(asB) })
    );
    expect(_live(out.id)!.state).toBe("confirm");
    // M can compute the second code too: it chose both sides' inputs. What
    // protects A is that a person reads that code off the real B's screen,
    // and the real B never heard of this request, so it shows none. Without
    // it, a person can only guess, and guesses run out.
    for (const left of [2, 1, 0])
      expect(confirmLink(out.id, "123456", aDeps())).toMatchObject({
        ok: false,
        attemptsLeft: left,
      });
    expect(_live(out.id)!.state).toBe("failed");
    expect(pinnedOnA).toEqual([]);
    expect(pinnedOnB).toEqual([]);
  });

  it("pins nothing on either side when control lies to both", async () => {
    const onA = await startLink(
      B.machineId,
      aDeps({
        list: [listing(B, M)],
        post: toB(bDeps({ me: { ...M, machineId: B.machineId } })),
      })
    );
    resetIncoming();
    const realB = bDeps({ list: [listing(A, M)] });
    const viaM = await startLink(
      B.machineId,
      aDeps({ me: { ...M, machineId: A.machineId }, post: toB(realB) })
    );
    // The person types what A shows on B: wrong, so B shows nothing back...
    const [req] = pendingRequests(clock);
    expect(viaM.code).not.toBe(onA.code);
    expect(await acceptRequest(req.id, onA.code, realB)).toMatchObject({
      ok: false,
    });
    // ...and whatever M tells A, A only pins on a code from B's screen.
    expect(confirmLink(onA.id, viaM.code, aDeps())).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(pinnedOnA).toEqual([]);
    expect(pinnedOnB).toEqual([]);
  });

  it("ends the confirm step after three wrong codes or five minutes", async () => {
    const one = await startLink(B.machineId, aDeps());
    const back = await acceptOnB(one.code);
    await poll(_live(one.id)!, A, aDeps());
    for (let i = 0; i < 3; i++) confirmLink(one.id, otherThan(back), aDeps());
    expect(confirmLink(one.id, back, aDeps())).toMatchObject({ status: 404 });
    expect(_live(one.id)!).toMatchObject({ state: "failed", attemptsLeft: 0 });

    const two = await startLink(B.machineId, aDeps());
    const back2 = await acceptOnB(two.code);
    await poll(_live(two.id)!, A, aDeps());
    clock += REQUEST_TTL_MS + 1;
    expect(confirmLink(two.id, back2, aDeps())).toMatchObject({ status: 404 });
    expect(_live(two.id)!.state).toBe("expired");
    expect(pinnedOnA).toEqual([]);
  });

  it("keeps one open request per sender: a newer one replaces it", async () => {
    const first = await startLink(B.machineId, aDeps());
    await startLink(B.machineId, aDeps());
    expect(pendingRequests(clock)).toHaveLength(1);
    expect(_live(first.id)!.state).toBe("declined");
    // Its old request on B is over too: its code does nothing there.
    await poll(_live(first.id)!, A, aDeps());
    expect(
      await acceptRequest(pendingRequests(clock)[0].id, first.code, bDeps())
    ).toMatchObject({ ok: false });
  });

  it("holds one address to its share of the hellos anyone may send", async () => {
    const deps = bDeps({ list: [] });
    for (let i = 0; i < 20; i++)
      expect(
        (await receiveHello(helloFrom(M).hello, deps, "198.51.100.7")).status
      ).toBe(403);
    expect(
      await receiveHello(helloFrom(M).hello, deps, "198.51.100.7")
    ).toMatchObject({ status: 429 });
    // Someone else still gets through.
    expect(
      (await receiveHello(helloFrom(A).hello, bDeps(), "203.0.113.9")).status
    ).toBe(200);
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

  it("voids a request after three wrong codes", async () => {
    const out = await startLink(B.machineId, aDeps());
    const [req] = pendingRequests(clock);
    const wrong = otherThan(out.code);
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

describe("pairing under concurrency and reloads", () => {
  /** A promise this test settles when it chooses. */
  const gate = () => {
    let open!: (v: boolean) => void;
    const p = new Promise<boolean>((r) => (open = r));
    return { p, open };
  };
  const hellos = () =>
    (
      globalThis as unknown as {
        __agentosPairingIn: {
          hellos: { from: string | null; source: string }[];
        };
      }
    ).__agentosPairingIn.hellos;

  it("tags each hello with its own sender, whatever arrived meanwhile", async () => {
    const C = fakeMachine("cccc3333");
    const first = gate();
    const slow = receiveHello(
      helloFrom(A).hello,
      { ...bDeps({ list: [listing(A), listing(C)] }), allowed: () => first.p },
      "src-a"
    );
    // Another hello lands while A's waits on the plan.
    const quick = receiveHello(
      helloFrom(C).hello,
      bDeps({ list: [listing(A), listing(C)] }),
      "src-c"
    );
    first.open(true);
    await Promise.all([slow, quick]);
    expect(hellos().map((h) => [h.source, h.from])).toEqual([
      ["src-a", A.machineId],
      ["src-c", C.machineId],
    ]);
  });

  it("re-checks the request after the plan check: a decline meanwhile wins", async () => {
    const out = await startLink(B.machineId, aDeps());
    const [req] = pendingRequests(clock);
    const plan = gate();
    const taking = acceptRequest(req.id, out.code, {
      ...bDeps(),
      allowed: () => plan.p,
    });
    expect(declineRequest(req.id)).toBe(true);
    plan.open(true);
    expect(await taking).toMatchObject({ ok: false, status: 404 });
    expect(pinnedOnB).toEqual([]);
  });

  it("keeps the second code for a reload, only for those who could accept", async () => {
    const out = await startLink(B.machineId, aDeps());
    const back = await acceptOnB(out.code);
    const [after] = pendingRequests(clock, { withCodes: true });
    expect(after).toMatchObject({ state: "accepted", confirmCode: back });
    expect(pendingRequests(clock)[0].confirmCode).toBeUndefined();
    // Gone with the request's five minutes.
    expect(
      pendingRequests(clock + REQUEST_TTL_MS + 1, { withCodes: true })
    ).toEqual([]);
  });
});
