/**
 * POST /api/peer/rpc: a linked machine's call, served before Next on any
 * listener (the envelope is the authentication, not where it came from).
 *
 *  1. read the envelope, refusing an unlinked sender as soon as its header
 *     arrives, before the body is buffered;
 *  2. verify and decrypt it against the sender's pinned keys (envelope.ts);
 *  3. match the inner method, path and query against the allowlist;
 *  4. re-issue it to this machine's own loopback listener with the per-boot
 *     secret, so the gate stamps `peer` trust and every route and guard runs
 *     exactly as it does for any other caller.
 *
 * Refusals before decryption are plain and fixed (`unknown peer`, `bad
 * signature`, `stale`, `replay`); everything after is inside the envelope,
 * always HTTP 200, so whoever carries the traffic never learns the route or
 * its status.
 */

import http, { type IncomingMessage, type ServerResponse } from "http";
import { PEER_HEADER, PEER_INTERNAL_HEADER } from "../security/auth";
import { matchPeerRoute } from "./allowlist";
import { recordPeerCall, type AuditEntry, type Outcome } from "./audit";
import {
  MAX_HEADER,
  MAX_REQUEST_ENVELOPE,
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
import { createReplayGuard, type ReplayGuard } from "./replay";

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
  now?: () => number;
}

export const isPeerRpc = (req: IncomingMessage) =>
  (req.url ?? "").split("?")[0] === RPC_PATH;

const REFUSED: Record<Refusal, [number, string, Outcome]> = {
  bad_envelope: [400, "bad envelope", "bad_sig"],
  wrong_machine: [401, "bad signature", "bad_sig"],
  unknown_peer: [403, "unknown peer", "unknown_peer"],
  suspended: [403, "suspended", "suspended"],
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

type Early = Refusal | null;

/**
 * The body, at most MAX_REQUEST_ENVELOPE bytes. `early` sees the header as
 * soon as it has arrived; a refusal there stops reading.
 */
function readEnvelope(
  req: IncomingMessage,
  early: (headerBytes: Buffer) => Early
): Promise<{ body: Buffer } | { refusal: Refusal } | { tooLarge: true }> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"]) > MAX_REQUEST_ENVELOPE)
      return resolve({ tooLarge: true });
    const chunks: Buffer[] = [];
    let total = 0;
    let checked = false;
    let done = false;
    const finish = (v: Parameters<typeof resolve>[0]) => {
      if (done) return;
      done = true;
      // An unread rest is dropped with the connection (Connection: close).
      req.removeAllListeners("data");
      resolve(v);
    };
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > MAX_REQUEST_ENVELOPE) return finish({ tooLarge: true });
      chunks.push(chunk);
      if (checked || total < 4) return;
      const head = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      const len = head.readUInt32BE(0);
      if (len > MAX_HEADER) return finish({ refusal: "bad_envelope" });
      if (head.length < 4 + len) return;
      checked = true;
      const refusal = early(head.subarray(4, 4 + len));
      if (refusal) finish({ refusal });
    });
    req.on("end", () => finish({ body: Buffer.concat(chunks) }));
    req.on("error", (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });
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
  const refuse = (refusal: Refusal) => {
    const [status, text, outcome] = REFUSED[refusal];
    audit(outcome, status);
    plain(res, status, text);
  };
  const lookup = (machineId: string) => {
    fromMachine = machineId;
    pin = deps.pinForMachine(machineId);
    return pin;
  };

  let read;
  try {
    read = await readEnvelope(req, (headerBytes) => {
      const header = parseHeaderBytes(headerBytes);
      if (!header) return "bad_envelope";
      if (!self || header.to !== self.machineId) return "wrong_machine";
      const found = lookup(header.from);
      if (!found) return "unknown_peer";
      return found.state === "active" ? null : "suspended";
    });
  } catch {
    return plain(res, 400, "bad envelope");
  }
  if ("tooLarge" in read) return plain(res, 413, "too large");
  if ("refusal" in read) return refuse(read.refusal);
  if (!self) return refuse("wrong_machine");

  const opened = openRequest(read.body, {
    self: self.machineId,
    boxKey: deps.boxKey().privateKey,
    signKeyFor: (machineId) => {
      const found = lookup(machineId);
      if (!found) return "unknown_peer";
      if (found.state !== "active") return "suspended";
      try {
        return signPublic(found.signPub);
      } catch {
        return "unknown_peer";
      }
    },
    replay: deps.replay,
    now: deps.now?.(),
  });
  if (!opened.ok) return refuse(opened.refusal);
  const host = pin as PeerPin | null;
  if (!host) return refuse("unknown_peer");

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
    replay: createReplayGuard(),
    dispatch: loopbackDispatch(port),
    audit: recordPeerCall,
  };
}
