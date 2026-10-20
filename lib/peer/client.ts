/**
 * hostApi's transport for a machine linked through Connect: each call is a
 * fresh envelope (envelope.ts) to POST https://<its m- name>/api/peer/rpc,
 * and the answer only counts if it is signed by the pinned key and bound to
 * this request's nonce. No token is ever sent or stored.
 */

import { matchPeerRoute } from "./allowlist";
import { recordPeerCall, type AuditEntry, type Outcome } from "./audit";
import {
  MAX_REQUEST_BODY,
  MAX_RESPONSE_ENVELOPE,
  RPC_PATH,
  openResponse,
  sealRequest,
} from "./envelope";
import { boxPublic, currentIdentity, signPublic, type Identity } from "./keys";
import { notePinResult } from "./links";
import type { HostLink } from "../hosts/remote-api";
import { readCappedBytes } from "../hosts/read-capped-bytes";

/**
 * A failed peer call. `refused`: the other machine (or this one, before
 * sending) said no, so nothing happened there.
 */
export class PeerCallError extends Error {
  constructor(
    message: string,
    readonly refused: boolean,
    readonly status?: number
  ) {
    super(message);
  }
}

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Only a Connect machine's own name, so a lying account list can't aim this
 * machine at an internal address. AGENTOS_CONNECT_PEER_DOMAIN is for a
 * staging service.
 */
export function peerHostAllowed(hostname: string, env = process.env): boolean {
  const configured = env.AGENTOS_CONNECT_PEER_DOMAIN ?? "";
  const domain = DOMAIN.test(configured) ? configured : "runagentos.com";
  const escaped = domain.replace(/\./g, "\\.");
  return new RegExp(`^m-[0-9a-f]{16}\\.${escaped}$`).test(hostname);
}

// The fixed refusals rpc-server.ts sends before anything is decrypted.
const REFUSALS: Record<string, Outcome> = {
  "bad signature": "bad_sig",
  "bad envelope": "bad_sig",
  stale: "stale",
  replay: "replay",
  busy: "replay",
  "too large": "bad_sig",
};

const HINTS: Record<string, string> = {
  "bad signature":
    "it doesn't know this machine, the link is suspended there, or the keys don't match",
  stale: "the clocks on the two machines differ by more than 2 minutes",
};

export interface ClientDeps {
  identity: () => Identity | null;
  audit: (e: AuditEntry) => void;
  noteResult: (hostId: string, error: string | null) => void;
}

const realDeps: ClientDeps = {
  identity: () => currentIdentity(),
  audit: recordPeerCall,
  noteResult: notePinResult,
};

export async function peerCall(
  link: HostLink,
  target: string,
  opts: { method?: string; body?: unknown; timeout?: number },
  deps: ClientDeps = realDeps
): Promise<{ status: number; text: string }> {
  const peer = link.connect;
  const refuse = (msg: string): never => {
    throw new PeerCallError(msg, true);
  };
  if (!peer) return refuse("isn't linked through Connect");
  if (peer.state !== "active")
    return refuse(
      `the link is suspended (${peer.suspendedReason ?? "no reason given"})`
    );
  if (!peerHostAllowed(peer.hostname))
    return refuse("its address isn't a Connect machine's");
  const method = (
    opts.method ?? (opts.body === undefined ? "GET" : "POST")
  ).toUpperCase();
  const q = target.indexOf("?");
  const match = matchPeerRoute(
    method,
    q < 0 ? target : target.slice(0, q),
    q < 0 ? "" : target.slice(q + 1)
  );
  if (!match.ok) return refuse("that call isn't open to linked machines");
  const identity = deps.identity();
  if (!identity)
    return refuse("this machine isn't connected to AgentOS Connect");
  const body =
    opts.body === undefined
      ? Buffer.alloc(0)
      : Buffer.from(JSON.stringify(opts.body));
  if (body.length > MAX_REQUEST_BODY) return refuse("the request is too large");

  const started = Date.now();
  const audit = (outcome: Outcome, status: number, bytes: number) =>
    deps.audit({
      hostId: link.hostId,
      machineId: peer.machineId,
      direction: "out",
      method,
      route: match.route,
      status,
      ms: Date.now() - started,
      bytes,
      outcome,
    });
  const sealed = sealRequest({
    from: identity.machineId,
    to: peer.machineId,
    signKey: identity.signKey,
    peerBox: boxPublic(peer.boxPub),
    request: {
      method,
      path: match.path,
      query: match.query,
      contentType: body.length ? "application/json" : "",
      body,
    },
  });
  let res: Response;
  let raw: Buffer;
  try {
    res = await fetch(`https://${peer.hostname}${RPC_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(sealed.envelope),
      signal: AbortSignal.timeout(opts.timeout ?? 15000),
      redirect: "error",
    });
    raw = await readCappedBytes(res, MAX_RESPONSE_ENVELOPE);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.noteResult(link.hostId, message);
    throw new PeerCallError(message, false);
  }
  if (res.status !== 200) {
    const text = raw.subarray(0, 64).toString("utf8").trim();
    const outcome = REFUSALS[text];
    if (outcome && res.status >= 400 && res.status < 500) {
      audit(outcome, res.status, sealed.envelope.length);
      const message = HINTS[text] ? `${text}: ${HINTS[text]}` : text;
      deps.noteResult(link.hostId, message);
      // A refusal is unsigned: anyone on the path could forge one. A read
      // changes nothing either way, but a write may have happened.
      throw new PeerCallError(message, method === "GET", res.status);
    }
    deps.noteResult(link.hostId, `HTTP ${res.status}`);
    throw new PeerCallError(`HTTP ${res.status}`, false, res.status);
  }
  let answer;
  try {
    answer = openResponse({
      envelope: raw,
      nonce: sealed.nonce,
      resKey: sealed.resKey,
      peerSign: signPublic(peer.signPub),
    });
  } catch (err) {
    // It may have run there; the answer just can't be trusted.
    const message = err instanceof Error ? err.message : String(err);
    audit("bad_sig", 200, sealed.envelope.length + raw.length);
    deps.noteResult(link.hostId, message);
    throw new PeerCallError(message, false);
  }
  audit("ok", answer.status, body.length + answer.body.length);
  deps.noteResult(link.hostId, null);
  return { status: answer.status, text: answer.body.toString("utf8") };
}
