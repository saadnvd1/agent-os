/**
 * Pairing, on the machine that asks (A): send the hello to the machine the
 * account lists, check its answer is signed by the key the account lists
 * for it, reveal, show the code, then ask every couple of seconds until a
 * person on the other machine has typed it. B then shows a second code, and
 * only that code typed here pins B: the account list alone never does, so a
 * control plane that lists a key of its own for B can't get itself pinned.
 */

import { readCappedBytes } from "../hosts/read-capped-bytes";
import { peerHostAllowed } from "./client";
import { linkingAllowed, listedPeer, type AccountPeer } from "./account";
import {
  HELLO_MAX_BYTES,
  commitTo,
  deriveCode,
  parseAck,
  parseAnswer,
  randomNonce,
  sameCode,
  signHello,
  signReveal,
  signStatusAsk,
  typedCode,
  verifyAck,
  verifyAnswer,
  type LinkState,
} from "./hello";
import { currentIdentity, loadBoxKey, type Identity } from "./keys";
import { notifyLinked } from "./notify";
import { MAX_WRONG, REQUEST_TTL_MS } from "./pairing";
import { KEY_CHANGED, keysChanged, pinPeer } from "./pin";

/** `confirm`: B took the code and shows its own, to be typed here. */
export type OutState = LinkState | "confirm" | "failed";

export interface Outgoing {
  id: string;
  machineId: string;
  name: string;
  code: string;
  state: OutState;
  error: string | null;
  hostId: string | null;
  attemptsLeft: number;
  startedAt: number;
  expiresAt: number;
}

interface Live extends Outgoing {
  peer: AccountPeer;
  requestId: string;
  bBox: string;
  confirmCode: string;
  timer: NodeJS.Timeout | null;
}

export type Post = (
  hostname: string,
  path: string,
  body: object
) => Promise<{ status: number; json: unknown }>;

export interface OutDeps {
  identity: () => Identity | null;
  boxPub: () => string;
  listed: (machineId: string) => Promise<AccountPeer | null>;
  allowed: () => Promise<boolean | null>;
  post: Post;
  pin: typeof pinPeer;
  onLinked: (name: string) => void;
  now: () => number;
  pollMs: number;
}

/** POSTs JSON to the other machine's Connect name: no redirects, small answers. */
export const httpsPost: Post = async (hostname, path, body) => {
  if (!peerHostAllowed(hostname))
    throw new Error("its address isn't a Connect machine's");
  const res = await fetch(`https://${hostname}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await readCappedBytes(res, HELLO_MAX_BYTES);
  let json: unknown = null;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    // not JSON: only the status says anything
  }
  return { status: res.status, json };
};

let box: string | null = null;
export const realOutDeps = (): OutDeps => ({
  identity: () => currentIdentity(),
  boxPub: () => (box ??= loadBoxKey().publicRaw),
  listed: listedPeer,
  allowed: linkingAllowed,
  post: httpsPost,
  pin: pinPeer,
  onLinked: notifyLinked,
  now: Date.now,
  pollMs: 2000,
});

const g = globalThis as unknown as { __agentosPairingOut?: Map<string, Live> };
const links = () => (g.__agentosPairingOut ??= new Map());

export const resetOutgoing = () => {
  for (const l of links().values()) if (l.timer) clearTimeout(l.timer);
  g.__agentosPairingOut = undefined;
};

const view = (l: Live): Outgoing => ({
  id: l.id,
  machineId: l.machineId,
  name: l.name,
  code: l.code,
  state: l.state,
  error: l.error,
  hostId: l.hostId,
  attemptsLeft: l.attemptsLeft,
  startedAt: l.startedAt,
  expiresAt: l.expiresAt,
});

export class LinkError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const theirError = (json: unknown, status: number) => {
  const e = (json as { error?: unknown } | null)?.error;
  return typeof e === "string"
    ? e.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 200)
    : `HTTP ${status}`;
};

/** Starts a link to an account machine; the answer carries the code to show. */
export async function startLink(
  machineId: string,
  deps: OutDeps = realOutDeps()
): Promise<Outgoing> {
  const self = deps.identity();
  if (!self)
    throw new LinkError(
      "This machine isn't connected to AgentOS Connect.",
      409
    );
  if ((await deps.allowed()) !== true)
    throw new LinkError("Linking machines needs AgentOS Connect Pro.", 402);
  const peer = await deps.listed(machineId);
  if (!peer)
    throw new LinkError("That machine isn't on your AgentOS account.", 404);
  if (!peerHostAllowed(peer.hostname))
    throw new LinkError("Its address isn't a Connect machine's.", 502);
  if (keysChanged(peer.id, peer)) throw new LinkError(KEY_CHANGED, 409);
  for (const l of links().values())
    if (l.machineId === machineId && open(l))
      stop(l, "declined", "replaced by a new request");

  const aNonce = randomNonce(32);
  const aBox = deps.boxPub();
  const hello = signHello(self.signKey, {
    from: self.machineId,
    to: peer.id,
    ts: deps.now(),
    nonce: randomNonce(16),
    sign_pub: self.signPub,
    box_pub: aBox,
    commit: commitTo(aBox, self.signPub, aNonce),
  });
  const send = async (path: string, body: object) => {
    try {
      return await deps.post(peer.hostname, path, body);
    } catch (err) {
      throw new LinkError(
        `Can't reach ${peer.name}: ${err instanceof Error ? err.message : String(err)}`,
        502
      );
    }
  };
  const helloRes = await send("/api/peer/hello", hello);
  if (helloRes.status !== 200)
    throw new LinkError(
      `${peer.name} said no: ${theirError(helloRes.json, helloRes.status)}`,
      helloRes.status === 402 ? 402 : 502
    );
  const ack = parseAck(helloRes.json);
  // Signed by the key the account lists for it, answering this hello.
  if (!ack || !verifyAck(ack, hello, peer.signPub))
    throw new LinkError(`${peer.name} answered with the wrong key.`, 502);
  if (keysChanged(peer.id, { signPub: ack.sign_pub, boxPub: ack.box_pub }))
    throw new LinkError(KEY_CHANGED, 409);

  const reveal = signReveal(self.signKey, {
    from: self.machineId,
    to: peer.id,
    ts: deps.now(),
    nonce: randomNonce(16),
    request_id: ack.request_id,
    a_nonce: aNonce,
  });
  const revealRes = await send("/api/peer/hello/reveal", reveal);
  const answer = parseAnswer(revealRes.json);
  if (
    revealRes.status !== 200 ||
    !answer ||
    !verifyAnswer(answer, reveal, peer.signPub) ||
    answer.state !== "pending"
  )
    throw new LinkError(
      `${peer.name} didn't take the request: ${theirError(revealRes.json, revealRes.status)}`,
      502
    );

  const now = deps.now();
  const transcript = {
    from: self.machineId,
    to: peer.id,
    aSign: self.signPub,
    aBox,
    bSign: ack.sign_pub,
    bBox: ack.box_pub,
    aNonce,
    bNonce: ack.b_nonce,
  };
  const live: Live = {
    id: randomNonce(16),
    machineId: peer.id,
    name: peer.name,
    code: deriveCode(transcript),
    state: "pending",
    error: null,
    hostId: null,
    attemptsLeft: MAX_WRONG,
    startedAt: now,
    expiresAt: now + REQUEST_TTL_MS,
    peer,
    requestId: ack.request_id,
    bBox: ack.box_pub,
    confirmCode: deriveCode(transcript, "confirm"),
    timer: null,
  };
  links().set(live.id, live);
  schedule(live, self, deps);
  return view(live);
}

const open = (l: Live) => l.state === "pending" || l.state === "confirm";

function stop(l: Live, state: OutState, error: string | null = null) {
  if (l.timer) clearTimeout(l.timer);
  l.timer = null;
  l.state = state;
  l.error = error;
}

function schedule(l: Live, self: Identity, deps: OutDeps) {
  l.timer = setTimeout(() => void poll(l, self, deps), deps.pollMs);
  l.timer.unref?.();
}

/** One status call; exported for tests that drive the clock. */
export async function poll(l: Live, self: Identity, deps: OutDeps) {
  l.timer = null;
  if (l.state !== "pending") return;
  if (deps.now() > l.expiresAt) return stop(l, "expired");
  const ask = signStatusAsk(self.signKey, {
    from: self.machineId,
    to: l.machineId,
    ts: deps.now(),
    nonce: randomNonce(16),
    request_id: l.requestId,
  });
  let answer = null;
  try {
    const res = await deps.post(l.peer.hostname, "/api/peer/hello/status", ask);
    if (res.status === 404) return stop(l, "expired");
    const a = parseAnswer(res.json);
    if (res.status === 200 && a && verifyAnswer(a, ask, l.peer.signPub))
      answer = a;
    else l.error = `unexpected answer (HTTP ${res.status})`;
  } catch (err) {
    // Offline for a moment: keep asking until the request expires.
    l.error = err instanceof Error ? err.message : String(err);
  }
  if (l.state !== "pending") return;
  if (answer?.state === "accepted") {
    // Nothing is pinned yet: B's say-so is only as good as its key, and the
    // key came from the account list. The person types B's code here next.
    stop(l, "confirm");
    l.expiresAt = deps.now() + REQUEST_TTL_MS;
    return;
  }
  if (answer && answer.state !== "pending") return stop(l, answer.state);
  if (answer) l.error = null;
  schedule(l, self, deps);
}

export function outgoingLink(id: string): Outgoing | null {
  const l = links().get(id);
  return l ? view(l) : null;
}

export type ConfirmResult =
  | { ok: true; link: Outgoing }
  | { ok: false; status: number; error: string; attemptsLeft?: number };

/** The code the other machine shows once it took ours, typed here. */
export function confirmLink(
  id: string,
  input: unknown,
  deps: OutDeps = realOutDeps()
): ConfirmResult {
  const l = links().get(id);
  if (l?.state === "confirm" && deps.now() > l.expiresAt) stop(l, "expired");
  if (!l || l.state !== "confirm")
    return {
      ok: false,
      status: 404,
      error: "That request has ended. Start again.",
    };
  const code = typedCode(input);
  if (!code)
    return {
      ok: false,
      status: 400,
      error: `Type the 6 digits ${l.name} shows.`,
    };
  if (!sameCode(code, l.confirmCode)) {
    l.attemptsLeft -= 1;
    if (l.attemptsLeft <= 0) {
      stop(l, "failed", "wrong code 3 times");
      return {
        ok: false,
        status: 403,
        error: "Wrong code 3 times: nothing was linked here. Start again.",
        attemptsLeft: 0,
      };
    }
    return {
      ok: false,
      status: 403,
      error: "That code doesn't match.",
      attemptsLeft: l.attemptsLeft,
    };
  }
  try {
    l.hostId = deps.pin({
      id: l.peer.id,
      name: l.peer.name,
      hostname: l.peer.hostname,
      signPub: l.peer.signPub,
      boxPub: l.bBox,
    });
  } catch (err) {
    stop(l, "failed", err instanceof Error ? err.message : String(err));
    return { ok: false, status: 409, error: l.error! };
  }
  stop(l, "accepted");
  deps.onLinked(l.name);
  return { ok: true, link: view(l) };
}

export function cancelLink(id: string): boolean {
  const l = links().get(id);
  if (!l || !open(l)) return false;
  stop(l, "declined", "cancelled here");
  return true;
}

/** Tests: the live record behind a view, to drive poll() by hand. */
export const _live = (id: string) => links().get(id) ?? null;
