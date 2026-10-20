/**
 * Pairing, on the machine being asked (B). A hello is taken only from a key
 * the Connect account lists for its sender, and only while the plan
 * includes linking; it then waits, in memory, for the sender to reveal the
 * nonce it committed to, and then for a person here to type the code the
 * sender shows. Nothing is trusted until that code matches: B pins A then
 * and shows a second code, which the person types on A before A pins B.
 * A machine linked here already keeps its keys: one that comes back with
 * other keys is refused until a person unlinks it.
 *
 * Limits: hellos 5 per sender and 20 in all per 10 minutes, at most 3
 * requests open and one per sender (a newer one replaces it), each for 5
 * minutes, and 3 wrong codes void a request.
 * A server restart forgets every open request (the sender sees "expired").
 */

import { currentIdentity, loadBoxKey, type Identity } from "./keys";
import { linkingAllowed, listedPeer, type AccountPeer } from "./account";
import {
  commitTo,
  deriveCode,
  parseHello,
  parseReveal,
  parseStatusAsk,
  randomNonce,
  sameCode,
  signAck,
  signAnswer,
  typedCode,
  verifyHello,
  verifyReveal,
  verifyStatusAsk,
  withinSkew,
  SKEW_MS,
  type LinkState,
} from "./hello";
import { KEY_CHANGED, keysChanged, pinPeer } from "./pin";
import { notifyLinked, notifyLinkRequest } from "./notify";

export const REQUEST_TTL_MS = 5 * 60_000;
export const MAX_OPEN = 3;
export const MAX_WRONG = 3;
const WINDOW_MS = 10 * 60_000;
const PER_SENDER = 5;
const GLOBAL = 20;
// Hellos that get as far as the account list, from anyone: bounds the
// signature checks and list fetches a stranger can cause. One address (an
// IPv6 /64) is held to a share of it first, so it can't use it all up.
const UNPROVEN = 120;
const PER_SOURCE = 20;

interface Incoming {
  id: string;
  peer: AccountPeer;
  aSign: string;
  aBox: string;
  commit: string;
  bNonce: string;
  code: string | null;
  confirm: string | null;
  state: "revealing" | LinkState;
  why: string | null;
  wrong: number;
  createdAt: number;
}

export interface PairingDeps {
  identity: () => Identity | null;
  boxPub: () => string;
  listed: (machineId: string) => Promise<AccountPeer | null>;
  allowed: () => Promise<boolean | null>;
  pin: (p: AccountPeer & { boxPub: string }) => string;
  onRequest: (name: string) => void;
  onLinked: (name: string) => void;
  now: () => number;
}

interface Store {
  requests: Map<string, Incoming>;
  hellos: { at: number; from: string | null; source: string }[];
  seen: Map<string, number>;
}

const g = globalThis as unknown as { __agentosPairingIn?: Store };
const store = (): Store =>
  (g.__agentosPairingIn ??= {
    requests: new Map(),
    hellos: [],
    seen: new Map(),
  });

/** Tests: forget every request and every limit. */
export const resetIncoming = () => {
  g.__agentosPairingIn = undefined;
};

let box: string | null = null;
export const realPairingDeps = (): PairingDeps => ({
  identity: () => currentIdentity(),
  boxPub: () => (box ??= loadBoxKey().publicRaw),
  listed: listedPeer,
  allowed: linkingAllowed,
  pin: pinPeer,
  onRequest: notifyLinkRequest,
  onLinked: notifyLinked,
  now: Date.now,
});

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const no = (status: number, error: string): Reply => ({
  status,
  body: { error },
});

function sweep(s: Store, now: number) {
  for (const r of s.requests.values()) {
    if (r.state !== "accepted" && now - r.createdAt > REQUEST_TTL_MS) {
      if (r.state === "revealing" || r.state === "pending") r.state = "expired";
    }
    // Finished ones are kept a little so the sender can learn how it ended.
    if (now - r.createdAt > 2 * REQUEST_TTL_MS) s.requests.delete(r.id);
  }
  s.hellos = s.hellos.filter((h) => now - h.at < WINDOW_MS);
  for (const [k, until] of s.seen) if (until < now) s.seen.delete(k);
}

const open = (r: Incoming) => r.state === "revealing" || r.state === "pending";

/** A nonce, once per sender, for as long as its timestamp would pass. */
function fresh(s: Store, from: string, nonce: string, ts: number): boolean {
  const k = `${from}:${nonce}`;
  if (s.seen.has(k)) return false;
  s.seen.set(k, ts + SKEW_MS);
  return true;
}

/** POST /api/peer/hello */
export async function receiveHello(
  body: unknown,
  deps: PairingDeps = realPairingDeps(),
  source = "unknown"
): Promise<Reply> {
  const s = store();
  const now = deps.now();
  sweep(s, now);
  const hello = parseHello(body);
  if (!hello) return no(400, "bad hello");
  const self = deps.identity();
  if (!self || hello.to !== self.machineId)
    return no(403, "this isn't the machine you meant");
  if (!withinSkew(hello.ts, now))
    return no(401, "stale: the clocks on the two machines differ");
  if (
    s.hellos.filter((h) => h.source === source).length >= PER_SOURCE ||
    s.hellos.length >= UNPROVEN
  )
    return no(429, "too many requests");
  s.hellos.push({ at: now, from: null, source });
  const allowed = await deps.allowed();
  if (allowed !== true)
    return no(402, "Linking machines needs AgentOS Connect Pro");
  const listed = await deps.listed(hello.from);
  // Only a key this machine's own account lists for that machine may ask.
  if (!listed || listed.signPub !== hello.sign_pub)
    return no(403, "that machine isn't on this account");
  if (!verifyHello(hello)) return no(401, "bad signature");
  if (!fresh(s, hello.from, hello.nonce, hello.ts)) return no(401, "replay");
  if (
    keysChanged(hello.from, { signPub: hello.sign_pub, boxPub: hello.box_pub })
  )
    return no(409, KEY_CHANGED);
  const proven = s.hellos.filter((h) => h.from !== null);
  if (
    proven.length >= GLOBAL ||
    proven.filter((h) => h.from === hello.from).length >= PER_SENDER
  )
    return no(429, "too many link requests; wait a few minutes");
  s.hellos[s.hellos.length - 1].from = hello.from;
  for (const old of s.requests.values())
    if (old.peer.id === hello.from && open(old)) {
      old.state = "declined";
      old.why = "replaced by a newer request";
    }
  if ([...s.requests.values()].filter(open).length >= MAX_OPEN)
    return no(429, "too many link requests waiting here");

  const r: Incoming = {
    id: randomNonce(16),
    peer: listed,
    aSign: hello.sign_pub,
    aBox: hello.box_pub,
    commit: hello.commit,
    bNonce: randomNonce(32),
    code: null,
    confirm: null,
    state: "revealing",
    why: null,
    wrong: 0,
    createdAt: now,
  };
  s.requests.set(r.id, r);
  const ack = signAck(
    self.signKey,
    {
      request_id: r.id,
      sign_pub: self.signPub,
      box_pub: deps.boxPub(),
      b_nonce: r.bNonce,
    },
    hello
  );
  return { status: 200, body: { ...ack } };
}

/** Finds the request a signed reveal or status call is about. */
function askedAbout(
  s: Store,
  ask: {
    from: string;
    to: string;
    ts: number;
    nonce: string;
    request_id: string;
  },
  self: Identity | null,
  now: number
): Incoming | Reply {
  if (!self || ask.to !== self.machineId)
    return no(403, "this isn't the machine you meant");
  if (!withinSkew(ask.ts, now)) return no(401, "stale");
  const r = s.requests.get(ask.request_id);
  if (!r || r.peer.id !== ask.from) return no(404, "no such request");
  return r;
}

/** POST /api/peer/hello/reveal */
export function receiveReveal(
  body: unknown,
  deps: PairingDeps = realPairingDeps()
): Reply {
  const s = store();
  const now = deps.now();
  sweep(s, now);
  const reveal = parseReveal(body);
  if (!reveal) return no(400, "bad reveal");
  const self = deps.identity();
  const r = askedAbout(s, reveal, self, now);
  if (!("id" in r)) return r;
  if (!verifyReveal(reveal, r.aSign)) return no(401, "bad signature");
  if (!fresh(s, reveal.from, reveal.nonce, reveal.ts)) return no(401, "replay");
  if (r.state !== "revealing")
    return {
      status: 200,
      body: { ...signAnswer(self!.signKey, r.state, reveal) },
    };
  if (commitTo(r.aBox, r.aSign, reveal.a_nonce) !== r.commit) {
    // Whoever sent this chose its keys after seeing ours: void it.
    r.state = "declined";
    r.why = "its keys didn't match what it committed to";
    return no(403, "that doesn't match the hello");
  }
  const transcript = {
    from: r.peer.id,
    to: self!.machineId,
    aSign: r.aSign,
    aBox: r.aBox,
    bSign: self!.signPub,
    bBox: deps.boxPub(),
    aNonce: reveal.a_nonce,
    bNonce: r.bNonce,
  };
  r.code = deriveCode(transcript);
  r.confirm = deriveCode(transcript, "confirm");
  r.state = "pending";
  deps.onRequest(r.peer.name);
  return {
    status: 200,
    body: { ...signAnswer(self!.signKey, "pending", reveal) },
  };
}

/** POST /api/peer/hello/status */
export function receiveStatus(
  body: unknown,
  deps: PairingDeps = realPairingDeps()
): Reply {
  const s = store();
  const now = deps.now();
  sweep(s, now);
  const ask = parseStatusAsk(body);
  if (!ask) return no(400, "bad status request");
  const self = deps.identity();
  const r = askedAbout(s, ask, self, now);
  if (!("id" in r)) return r;
  if (!verifyStatusAsk(ask, r.aSign)) return no(401, "bad signature");
  if (!fresh(s, ask.from, ask.nonce, ask.ts)) return no(401, "replay");
  const state: LinkState = r.state === "revealing" ? "pending" : r.state;
  return { status: 200, body: { ...signAnswer(self!.signKey, state, ask) } };
}

export interface PendingView {
  id: string;
  machineId: string;
  name: string;
  lastSeenAt: string | null;
  expiresAt: number;
  attemptsLeft: number;
}

/** Requests waiting for a person here to type the code. */
export function pendingRequests(now = Date.now()): PendingView[] {
  const s = store();
  sweep(s, now);
  return [...s.requests.values()]
    .filter((r) => r.state === "pending")
    .map((r) => ({
      id: r.id,
      machineId: r.peer.id,
      name: r.peer.name,
      lastSeenAt: r.peer.lastSeenAt,
      expiresAt: r.createdAt + REQUEST_TTL_MS,
      attemptsLeft: MAX_WRONG - r.wrong,
    }));
}

export type AcceptResult =
  | { ok: true; hostId: string; name: string; confirmCode: string }
  | { ok: false; status: number; error: string; attemptsLeft?: number };

/** The code a person typed here, from a trusted device (the route checks). */
export async function acceptRequest(
  id: string,
  input: unknown,
  deps: PairingDeps = realPairingDeps()
): Promise<AcceptResult> {
  const s = store();
  sweep(s, deps.now());
  const r = s.requests.get(id);
  if (!r || r.state !== "pending" || !r.code || !r.confirm)
    return {
      ok: false,
      status: 404,
      error: "That request has ended. Start again from the other machine.",
    };
  const code = typedCode(input);
  if (!code)
    return {
      ok: false,
      status: 400,
      error: "Type the 6 digits the other machine shows.",
    };
  if (!sameCode(code, r.code)) {
    r.wrong += 1;
    if (r.wrong >= MAX_WRONG) {
      r.state = "declined";
      r.why = "wrong code 3 times";
      return {
        ok: false,
        status: 403,
        error:
          "Wrong code 3 times: the request is void. Start again from the other machine.",
        attemptsLeft: 0,
      };
    }
    return {
      ok: false,
      status: 403,
      error: "That code doesn't match.",
      attemptsLeft: MAX_WRONG - r.wrong,
    };
  }
  if ((await deps.allowed()) !== true)
    return {
      ok: false,
      status: 402,
      error: "Linking machines needs AgentOS Connect Pro.",
    };
  let hostId: string;
  try {
    hostId = deps.pin({ ...r.peer, signPub: r.aSign, boxPub: r.aBox });
  } catch (err) {
    r.state = "declined";
    r.why = "it couldn't be linked here";
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 409, error };
  }
  r.state = "accepted";
  deps.onLinked(r.peer.name);
  // The person types this on the other machine, which pins this one then.
  return { ok: true, hostId, name: r.peer.name, confirmCode: r.confirm };
}

export function declineRequest(id: string): boolean {
  const r = store().requests.get(id);
  if (!r || !open(r)) return false;
  r.state = "declined";
  r.why = "declined here";
  return true;
}
