/**
 * POST /api/peer/rpc: a linked machine's call, served before Next on any
 * listener (the envelope is the authentication, not where it came from).
 *
 *  1. read the envelope under a budget for unverified bytes and a minimum
 *     transfer rate (rpc-intake.ts), the same way whoever it claims to be;
 *  2. verify and decrypt it against the sender's pinned keys (envelope.ts);
 *  3. match the inner method, path and query against the allowlist;
 *  4. re-issue it to this machine's own loopback listener with the per-boot
 *     secret, so the gate stamps `peer` trust and every route and guard runs
 *     exactly as it does for any other caller.
 *
 * Refusals before decryption are plain and fixed (`bad envelope`, `bad
 * signature`, `stale`, `replay`, `busy`). An unknown sender, a suspended one
 * and a bad signature all read `bad signature`, so a stranger can't tell
 * which machines are linked here; the audit keeps the difference. Everything
 * after is inside the envelope,
 * always HTTP 200, so whoever carries the traffic never learns the route or
 * its status.
 */

import crypto from "crypto";
import http, { type IncomingMessage, type ServerResponse } from "http";
import { PEER_HEADER, PEER_INTERNAL_HEADER } from "../security/auth";
import { matchPeerRoute } from "./allowlist";
import { recordPeerCall, type AuditEntry, type Outcome } from "./audit";
import {
  MAX_RESPONSE_BODY,
  RPC_PATH,
  openRequest,
  parseHeaderBytes,
  sealResponse,
  type PeerResponse,
  type Refusal,
} from "./envelope";
import { peerSecret } from "./internal";
import {
  currentIdentity,
  loadBoxKey,
  signPublic,
  type BoxKey,
  type Identity,
} from "./keys";
import { pinForMachine, type PeerPin } from "./links";
import { sqliteNonceStore } from "./nonce-store";
import { createReplayGuard, type ReplayGuard } from "./replay";
import {
  DEFAULT_PACE,
  createBodyBudget,
  readEnvelope,
  sourceOf,
  type BodyBudget,
  type Pace,
} from "./rpc-intake";

export { createBodyBudget };

export { RPC_PATH };
const DISPATCH_TIMEOUT_MS = 10 * 60_000;

export interface Dispatch {
  hostId: string;
  method: string;
  path: string;
  query: string;
  contentType: string;
  body: Buffer;
}

export interface RpcDeps {
  identity: () => Identity | null;
  boxKey: () => BoxKey;
  pinForMachine: (machineId: string) => PeerPin | null;
  replay: ReplayGuard;
  dispatch: (d: Dispatch) => Promise<PeerResponse>;
  audit: (e: AuditEntry) => void;
  budget: BodyBudget;
  pace?: Pace;
  now?: () => number;
}

// Stands in for an unknown or suspended sender's key, so its envelope takes
// the same path, and the same time, to the same refusal as a bad signature.
const DECOY_KEY = crypto.generateKeyPairSync("ed25519").publicKey;

export const isPeerRpc = (req: IncomingMessage) =>
  (req.url ?? "").split("?")[0] === RPC_PATH;

const REFUSED: Record<Refusal, [number, string, Outcome]> = {
  bad_envelope: [400, "bad envelope", "bad_sig"],
  wrong_machine: [401, "bad signature", "bad_sig"],
  unknown_peer: [401, "bad signature", "unknown_peer"],
  suspended: [401, "bad signature", "suspended"],
  bad_sig: [401, "bad signature", "bad_sig"],
  stale: [401, "stale", "stale"],
  replay: [401, "replay", "replay"],
  busy: [429, "busy", "replay"],
};

function plain(res: ServerResponse, status: number, text: string) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "close");
  res.end(text);
}

export async function handlePeerRpc(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RpcDeps
): Promise<void> {
  const started = Date.now();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return plain(res, 405, "method not allowed");
  }
  const self = deps.identity();
  let fromMachine: string | null = null;
  let pin: PeerPin | null = null;
  const audit = (
    outcome: Outcome,
    status: number,
    route = RPC_PATH,
    method = "POST",
    bytes = 0
  ) =>
    deps.audit({
      hostId: pin?.hostId ?? null,
      machineId: fromMachine,
      direction: "in",
      method,
      route,
      status,
      ms: Date.now() - started,
      bytes,
      outcome,
    });
  const refuse = (refusal: Refusal): null => {
    const [status, text, outcome] = REFUSED[refusal];
    audit(outcome, status);
    plain(res, status, text);
    return null;
  };
  const lookup = (machineId: string) => {
    fromMachine = machineId;
    pin = deps.pinForMachine(machineId);
    return pin;
  };

  // What the signature check would have said, hidden behind it.
  let hidden: "unknown_peer" | "suspended" | null = null;
  const ticket = deps.budget.open(sourceOf(req));
  if (!ticket) return void refuse("busy");
  const readAndOpen = async () => {
    let read;
    try {
      read = await readEnvelope(req, {
        early: (headerBytes) => {
          const header = parseHeaderBytes(headerBytes);
          if (!header) return { refusal: "bad_envelope" };
          if (!self || header.to !== self.machineId)
            return { refusal: "wrong_machine" };
          return { peer: header.from };
        },
        ticket,
        pace: deps.pace ?? DEFAULT_PACE,
      });
    } catch {
      plain(res, 400, "bad envelope");
      return null;
    }
    if ("tooLarge" in read) {
      plain(res, 413, "too large");
      return null;
    }
    if ("tooSlow" in read) {
      plain(res, 408, "too slow");
      return null;
    }
    if ("refusal" in read) return refuse(read.refusal);
    if (!self) return refuse("wrong_machine");
    return openRequest(read.body, {
      self: self.machineId,
      boxKey: deps.boxKey().privateKey,
      signKeyFor: (machineId) => {
        const found = lookup(machineId);
        hidden = !found
          ? "unknown_peer"
          : found.state !== "active"
            ? "suspended"
            : null;
        if (hidden) return DECOY_KEY;
        try {
          return signPublic(found!.signPub);
        } catch {
          hidden = "unknown_peer";
          return DECOY_KEY;
        }
      },
      replay: deps.replay,
      now: deps.now?.(),
    });
  };
  let opened;
  try {
    opened = await readAndOpen();
  } finally {
    ticket.close();
  }
  if (!opened || !self) return;
  if (!opened.ok)
    return void refuse(
      opened.refusal === "bad_sig" && hidden ? hidden : opened.refusal
    );
  const host = pin as PeerPin | null;
  if (!host) return void refuse("unknown_peer");

  const answer = (response: PeerResponse, outcome: Outcome, route: string) => {
    const sealed = sealResponse({
      resKey: opened.resKey,
      nonce: opened.nonce,
      signKey: self.signKey,
      response,
    });
    audit(
      outcome,
      response.status,
      route,
      opened.request.method.slice(0, 10),
      opened.request.body.length + response.body.length
    );
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(sealed);
  };

  const { request } = opened;
  const match = matchPeerRoute(request.method, request.path, request.query);
  if (!match.ok)
    return answer(
      jsonResponse(403, { error: "That route isn't open to linked machines." }),
      "denied_route",
      "(denied)"
    );
  let response: PeerResponse;
  try {
    response = await deps.dispatch({
      hostId: host.hostId,
      method: request.method,
      path: match.path,
      query: match.query,
      contentType: request.contentType,
      body: request.body,
    });
  } catch (err) {
    response = jsonResponse(502, {
      error:
        `Couldn't run that here: ${err instanceof Error ? err.message : String(err)}`.slice(
          0,
          300
        ),
    });
  }
  answer(response, "ok", match.route);
}

const jsonResponse = (status: number, body: object): PeerResponse => ({
  status,
  contentType: "application/json",
  body: Buffer.from(JSON.stringify(body)),
});

const CONTENT_TYPE = /^[\w.+-]+\/[\w.+-]+(;[ \w.+=\-"]*)?$/;

/** Re-issues a verified call to this machine's own loopback listener. */
export function loopbackDispatch(
  port: number,
  secret: () => string = peerSecret
): (d: Dispatch) => Promise<PeerResponse> {
  return (d) =>
    new Promise((resolve, reject) => {
      const contentType =
        d.contentType.length <= 200 && CONTENT_TYPE.test(d.contentType)
          ? d.contentType
          : "application/octet-stream";
      const out = http.request(
        {
          host: "127.0.0.1",
          port,
          method: d.method,
          path: d.query ? `${d.path}?${d.query}` : d.path,
          headers: {
            host: `127.0.0.1:${port}`,
            ...(d.body.length > 0 && { "content-type": contentType }),
            "content-length": String(d.body.length),
            [PEER_INTERNAL_HEADER]: secret(),
            [PEER_HEADER]: d.hostId,
          },
          timeout: DISPATCH_TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let total = 0;
          res.on("data", (c: Buffer) => {
            total += c.length;
            if (total > MAX_RESPONSE_BODY) {
              res.destroy();
              return reject(new Error("its answer is too large"));
            }
            chunks.push(c);
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 502,
              contentType: String(res.headers["content-type"] ?? ""),
              body: Buffer.concat(chunks),
            })
          );
          res.on("error", reject);
        }
      );
      out.on("timeout", () => out.destroy(new Error("timed out")));
      out.on("error", reject);
      out.end(d.body);
    });
}

/** The real dependencies: this machine's keys, its pins and its listener. */
export function rpcDeps(port: number): RpcDeps {
  let box: BoxKey | null = null;
  return {
    identity: () => currentIdentity(),
    boxKey: () => (box ??= loadBoxKey()),
    pinForMachine,
    replay: createReplayGuard({ store: sqliteNonceStore() }),
    dispatch: loopbackDispatch(port),
    audit: recordPeerCall,
    budget: createBodyBudget(),
  };
}
