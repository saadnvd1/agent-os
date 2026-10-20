/**
 * The signed, encrypted envelope linked machines call each other with
 * (Node's crypto only).
 *
 * Request body: u32 header length ‖ header JSON ‖ ciphertext ‖ signature.
 *   header  {v:1, from, to, ts, nonce, epk}, epk a fresh X25519 key per call
 *   keys    HKDF-SHA256(X25519(epk, B_box), salt=nonce,
 *                       info="agentos-peer-v1|from|to") → k_req ‖ k_res
 *   ct      ChaCha20-Poly1305(k_req, AAD=header) over the inner request
 *   sig     Ed25519_A("agentos-peer-req-v1" ‖ header ‖ SHA256(ct))
 *
 * Response body: ct ‖ sig, where ct = ChaCha20-Poly1305(k_res) over the
 * inner response and sig = Ed25519_B("agentos-peer-res-v1" ‖ request nonce ‖
 * SHA256(ct)), so it only opens for the request it answers.
 *
 * Each key seals exactly one message, so a fixed all-zero IV is safe.
 */

import crypto, { type KeyObject } from "crypto";
import { MACHINE_ID } from "../connect/control-api";
import { rawPublic } from "./keys";
import { type ReplayGuard } from "./replay";

export const RPC_PATH = "/api/peer/rpc";
export const MAX_REQUEST_BODY = 100 * 1024 * 1024;
export const MAX_RESPONSE_BODY = 80 * 1024 * 1024;
const OVERHEAD = 64 * 1024;
export const MAX_REQUEST_ENVELOPE = MAX_REQUEST_BODY + OVERHEAD;
export const MAX_RESPONSE_ENVELOPE = MAX_RESPONSE_BODY + OVERHEAD;
export const SKEW_MS = 120_000;

export const MAX_HEADER = 1024;
const MAX_META = 16 * 1024;
const SIG = 64;
const TAG = 16;
const IV = Buffer.alloc(12);
const REQ_DOMAIN = Buffer.from("agentos-peer-req-v1");
const RES_DOMAIN = Buffer.from("agentos-peer-res-v1");
const B64_16 = /^[A-Za-z0-9_-]{22}$/;
const B64_32 = /^[A-Za-z0-9_-]{43}$/;

export interface PeerRequest {
  method: string;
  path: string;
  /** URL query without the "?"; checked against the route's keys. */
  query: string;
  contentType: string;
  body: Buffer;
}

export interface PeerResponse {
  status: number;
  contentType: string;
  body: Buffer;
}

export interface RequestHeader {
  v: 1;
  from: string;
  to: string;
  ts: number;
  nonce: string;
  epk: string;
}

/** Why an envelope was refused before anything inside it was trusted. */
export type Refusal =
  | "bad_envelope"
  | "wrong_machine"
  | "unknown_peer"
  | "suspended"
  | "bad_sig"
  | "stale"
  | "replay"
  | "busy";

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();

function frame(meta: object, body: Buffer): Buffer {
  const m = Buffer.from(JSON.stringify(meta));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(m.length);
  return Buffer.concat([len, m, body]);
}

function unframe(buf: Buffer, max: number): { meta: unknown; rest: Buffer } {
  if (buf.length < 4) throw new Error("short");
  const len = buf.readUInt32BE(0);
  if (len > max || 4 + len > buf.length) throw new Error("bad length");
  return {
    meta: JSON.parse(buf.subarray(4, 4 + len).toString("utf8")),
    rest: buf.subarray(4 + len),
  };
}

function keysFor(
  shared: Buffer,
  nonce: Buffer,
  from: string,
  to: string
): { req: Buffer; res: Buffer } {
  const okm = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      shared,
      nonce,
      `agentos-peer-v1|${from}|${to}`,
      64
    )
  );
  return { req: okm.subarray(0, 32), res: okm.subarray(32) };
}

function seal(key: Buffer, plain: Buffer, aad?: Buffer): Buffer {
  const c = crypto.createCipheriv("chacha20-poly1305", key, IV, {
    authTagLength: TAG,
  });
  if (aad) c.setAAD(aad, { plaintextLength: plain.length });
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

function unseal(key: Buffer, ct: Buffer, aad?: Buffer): Buffer {
  if (ct.length < TAG) throw new Error("short");
  const d = crypto.createDecipheriv("chacha20-poly1305", key, IV, {
    authTagLength: TAG,
  });
  d.setAuthTag(ct.subarray(ct.length - TAG));
  if (aad) d.setAAD(aad, { plaintextLength: ct.length - TAG });
  return Buffer.concat([d.update(ct.subarray(0, ct.length - TAG)), d.final()]);
}

export interface Sealed {
  envelope: Buffer;
  nonce: Buffer;
  /** Opens the answer to this request, and nothing else. */
  resKey: Buffer;
}

export function sealRequest(o: {
  from: string;
  to: string;
  signKey: KeyObject;
  peerBox: KeyObject;
  request: PeerRequest;
  now?: number;
}): Sealed {
  const nonce = crypto.randomBytes(16);
  const eph = crypto.generateKeyPairSync("x25519");
  const header: RequestHeader = {
    v: 1,
    from: o.from,
    to: o.to,
    ts: o.now ?? Date.now(),
    nonce: nonce.toString("base64url"),
    epk: rawPublic(eph.publicKey),
  };
  const headerBytes = Buffer.from(JSON.stringify(header));
  const shared = crypto.diffieHellman({
    privateKey: eph.privateKey,
    publicKey: o.peerBox,
  });
  const keys = keysFor(shared, nonce, o.from, o.to);
  const { body, ...meta } = o.request;
  const ct = seal(keys.req, frame(meta, body), headerBytes);
  const sig = crypto.sign(
    null,
    Buffer.concat([REQ_DOMAIN, headerBytes, sha256(ct)]),
    o.signKey
  );
  const len = Buffer.alloc(4);
  len.writeUInt32BE(headerBytes.length);
  return {
    envelope: Buffer.concat([len, headerBytes, ct, sig]),
    nonce,
    resKey: keys.res,
  };
}

function parseHeader(raw: unknown): RequestHeader | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const h = raw as Record<string, unknown>;
  const keys = Object.keys(h).sort().join(",");
  if (keys !== "epk,from,nonce,to,ts,v") return null;
  if (h.v !== 1) return null;
  if (typeof h.from !== "string" || !MACHINE_ID.test(h.from)) return null;
  if (typeof h.to !== "string" || !MACHINE_ID.test(h.to)) return null;
  if (typeof h.ts !== "number" || !Number.isSafeInteger(h.ts)) return null;
  if (typeof h.nonce !== "string" || !B64_16.test(h.nonce)) return null;
  if (typeof h.epk !== "string" || !B64_32.test(h.epk)) return null;
  return h as unknown as RequestHeader;
}

/** The header alone, as soon as it has arrived (to refuse early). */
export function parseHeaderBytes(bytes: Buffer): RequestHeader | null {
  try {
    return parseHeader(JSON.parse(bytes.toString("utf8")));
  } catch {
    return null;
  }
}

export interface ParsedRequest {
  header: RequestHeader;
  headerBytes: Buffer;
  ct: Buffer;
  sig: Buffer;
}

/** The envelope's parts, or null when it isn't shaped like one. */
export function parseRequest(envelope: Buffer): ParsedRequest | null {
  try {
    if (envelope.length > MAX_REQUEST_ENVELOPE) return null;
    const { meta, rest } = unframe(envelope, MAX_HEADER);
    const header = parseHeader(meta);
    if (!header || rest.length < TAG + SIG) return null;
    const headerLen = envelope.readUInt32BE(0);
    return {
      header,
      headerBytes: envelope.subarray(4, 4 + headerLen),
      ct: rest.subarray(0, rest.length - SIG),
      sig: rest.subarray(rest.length - SIG),
    };
  } catch {
    return null;
  }
}

export interface OpenDeps {
  /** This machine's Connect id: an envelope for any other is refused. */
  self: string;
  boxKey: KeyObject;
  /** The pinned signing key for a peer, or why there isn't one. */
  signKeyFor: (machineId: string) => KeyObject | "unknown_peer" | "suspended";
  replay: ReplayGuard;
  now?: number;
}

export type Opened =
  | {
      ok: true;
      header: RequestHeader;
      request: PeerRequest;
      nonce: Buffer;
      resKey: Buffer;
    }
  | { ok: false; refusal: Refusal; header?: RequestHeader };

/**
 * Checks, in order: shape, addressed to this machine, a pinned peer, its
 * signature, the clock, a fresh nonce; then decrypts. A nonce is remembered
 * only once the signature holds, so nobody else can burn a peer's nonces.
 */
export function openRequest(envelope: Buffer, deps: OpenDeps): Opened {
  const parsed = parseRequest(envelope);
  if (!parsed) return { ok: false, refusal: "bad_envelope" };
  const { header, headerBytes, ct, sig } = parsed;
  const fail = (refusal: Refusal): Opened => ({ ok: false, refusal, header });
  if (header.to !== deps.self) return fail("wrong_machine");
  const signKey = deps.signKeyFor(header.from);
  if (typeof signKey === "string") return fail(signKey);
  let verified = false;
  try {
    verified = crypto.verify(
      null,
      Buffer.concat([REQ_DOMAIN, headerBytes, sha256(ct)]),
      signKey,
      sig
    );
  } catch {
    verified = false;
  }
  if (!verified) return fail("bad_sig");
  const now = deps.now ?? Date.now();
  const fresh = deps.replay.check(header.from, header.nonce, header.ts, now);
  if (fresh !== "ok") return fail(fresh);
  try {
    const nonce = Buffer.from(header.nonce, "base64url");
    const epk = crypto.createPublicKey({
      key: { kty: "OKP", crv: "X25519", x: header.epk },
      format: "jwk",
    });
    const shared = crypto.diffieHellman({
      privateKey: deps.boxKey,
      publicKey: epk,
    });
    const keys = keysFor(shared, nonce, header.from, header.to);
    const { meta, rest } = unframe(unseal(keys.req, ct, headerBytes), MAX_META);
    const request = parseInner(meta, rest);
    if (!request) return fail("bad_envelope");
    return { ok: true, header, request, nonce, resKey: keys.res };
  } catch {
    return fail("bad_envelope");
  }
}

function parseInner(meta: unknown, body: Buffer): PeerRequest | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const m = meta as Record<string, unknown>;
  if (
    typeof m.method !== "string" ||
    typeof m.path !== "string" ||
    typeof m.query !== "string" ||
    typeof m.contentType !== "string" ||
    body.length > MAX_REQUEST_BODY
  )
    return null;
  return {
    method: m.method,
    path: m.path,
    query: m.query,
    contentType: m.contentType,
    body,
  };
}

export function sealResponse(o: {
  resKey: Buffer;
  nonce: Buffer;
  signKey: KeyObject;
  response: PeerResponse;
}): Buffer {
  const { body, ...meta } = o.response;
  const ct = seal(o.resKey, frame(meta, body));
  const sig = crypto.sign(
    null,
    Buffer.concat([RES_DOMAIN, o.nonce, sha256(ct)]),
    o.signKey
  );
  return Buffer.concat([ct, sig]);
}

/** The answer to the request sealed with this nonce and key, from that peer. */
export function openResponse(o: {
  envelope: Buffer;
  nonce: Buffer;
  resKey: Buffer;
  peerSign: KeyObject;
}): PeerResponse {
  const { envelope } = o;
  if (envelope.length < TAG + SIG || envelope.length > MAX_RESPONSE_ENVELOPE)
    throw new Error("its answer isn't an envelope");
  const ct = envelope.subarray(0, envelope.length - SIG);
  const sig = envelope.subarray(envelope.length - SIG);
  let ok = false;
  try {
    ok = crypto.verify(
      null,
      Buffer.concat([RES_DOMAIN, o.nonce, sha256(ct)]),
      o.peerSign,
      sig
    );
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("its answer isn't signed by the linked machine");
  let meta: unknown;
  let body: Buffer;
  try {
    ({ meta, rest: body } = unframe(unseal(o.resKey, ct), MAX_META));
  } catch {
    throw new Error("its answer doesn't decrypt");
  }
  const m = (meta ?? {}) as Record<string, unknown>;
  if (
    typeof m.status !== "number" ||
    !Number.isInteger(m.status) ||
    m.status < 100 ||
    m.status > 599 ||
    typeof m.contentType !== "string"
  )
    throw new Error("its answer is malformed");
  return { status: m.status, contentType: m.contentType, body };
}
