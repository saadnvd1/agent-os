/**
 * The pairing messages between two machines, and the code both show.
 * Everything here is public data, signed by its sender with its Connect
 * machine key; each signature covers a domain string, both machine ids, a
 * timestamp and a nonce, so no message stands in for another or for another
 * pair of machines.
 *
 *   A → B  hello   {from, to, ts, nonce, sign_pub, box_pub, commit}
 *          commit = SHA-256(a_box ‖ a_sign ‖ a_nonce)
 *   B → A  ack     {request_id, sign_pub, box_pub, b_nonce}   (bound to the hello)
 *   A → B  reveal  {request_id, a_nonce}
 *   A → B  status  {request_id}
 *   B → A  answer  {state}                          (bound to that call's nonce)
 *
 * The code is HKDF over both machines' keys and both nonces. A has fixed
 * its keys and nonce before it sees b_nonce, and B's nonce is fresh, so
 * whoever substitutes keys gets one guess in a million per attempt.
 */

import crypto, { type KeyObject } from "crypto";
import { MACHINE_ID } from "../connect/control-api";
import { SKEW_MS } from "./envelope";
import { signPublic } from "./keys";

export const HELLO_MAX_BYTES = 4096;
export { SKEW_MS };

const B64_16 = /^[A-Za-z0-9_-]{22}$/;
const B64_32 = /^[A-Za-z0-9_-]{43}$/;
const B64_SIG = /^[A-Za-z0-9_-]{86}$/;

export type LinkState = "pending" | "accepted" | "declined" | "expired";
const STATES: readonly LinkState[] = [
  "pending",
  "accepted",
  "declined",
  "expired",
];

const D = {
  hello: "agentos-peer-hello-v1",
  ack: "agentos-peer-hello-ack-v1",
  reveal: "agentos-peer-reveal-v1",
  status: "agentos-peer-status-v1",
  answer: "agentos-peer-answer-v1",
} as const;

const b64 = (b: Buffer) => b.toString("base64url");
const raw = (s: string) => Buffer.from(s, "base64url");
export const randomNonce = (bytes: 16 | 32) => b64(crypto.randomBytes(bytes));

// Every field is checked against a pattern with no newline before it's
// signed or verified, so joining with "\n" is unambiguous.
const message = (domain: string, fields: (string | number)[]) =>
  Buffer.from([domain, ...fields.map(String)].join("\n"));

const signFields = (
  key: KeyObject,
  domain: string,
  fields: (string | number)[]
) => b64(crypto.sign(null, message(domain, fields), key));

function verifyFields(
  pub: string,
  sig: string,
  domain: string,
  fields: (string | number)[]
): boolean {
  if (!B64_SIG.test(sig)) return false;
  try {
    return crypto.verify(
      null,
      message(domain, fields),
      signPublic(pub),
      raw(sig)
    );
  } catch {
    return false;
  }
}

export const commitTo = (boxPub: string, signPub: string, nonce: string) =>
  b64(
    crypto
      .createHash("sha256")
      .update(Buffer.concat([raw(boxPub), raw(signPub), raw(nonce)]))
      .digest()
  );

/** The six digits both screens show, from both sides' keys and nonces. */
export function deriveCode(o: {
  from: string;
  to: string;
  aSign: string;
  aBox: string;
  bSign: string;
  bBox: string;
  aNonce: string;
  bNonce: string;
}): string {
  const ikm = Buffer.concat(
    [o.aSign, o.aBox, o.bSign, o.bBox, o.aNonce, o.bNonce].map(raw)
  );
  const okm = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      ikm,
      Buffer.alloc(0),
      `agentos-peer-sas-v1|${o.from}|${o.to}`,
      8
    )
  );
  return (okm.readBigUInt64BE(0) % BigInt(1_000_000))
    .toString()
    .padStart(6, "0");
}

export { showCode } from "./code";

/** What a person typed, as six digits, or null. */
export function typedCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 32) return null;
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

export const sameCode = (a: string, b: string) =>
  a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ----- the messages -----

interface Signed {
  from: string;
  to: string;
  ts: number;
  nonce: string;
  sig: string;
}

export interface Hello extends Signed {
  v: 1;
  sign_pub: string;
  box_pub: string;
  commit: string;
}

export interface Ack {
  request_id: string;
  sign_pub: string;
  box_pub: string;
  b_nonce: string;
  sig: string;
}

export interface Reveal extends Signed {
  v: 1;
  request_id: string;
  a_nonce: string;
}

export interface StatusAsk extends Signed {
  v: 1;
  request_id: string;
}

export interface Answer {
  state: LinkState;
  sig: string;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

function parseSigned(v: unknown): (Record<string, unknown> & Signed) | null {
  const o = obj(v);
  if (!o || o.v !== 1) return null;
  if (typeof o.from !== "string" || !MACHINE_ID.test(o.from)) return null;
  if (typeof o.to !== "string" || !MACHINE_ID.test(o.to)) return null;
  if (typeof o.ts !== "number" || !Number.isSafeInteger(o.ts)) return null;
  if (typeof o.nonce !== "string" || !B64_16.test(o.nonce)) return null;
  if (typeof o.sig !== "string" || !B64_SIG.test(o.sig)) return null;
  return o as Record<string, unknown> & Signed;
}

const is32 = (v: unknown): v is string =>
  typeof v === "string" && B64_32.test(v);
const is16 = (v: unknown): v is string =>
  typeof v === "string" && B64_16.test(v);

export function parseHello(v: unknown): Hello | null {
  const o = parseSigned(v);
  if (!o || !is32(o.sign_pub) || !is32(o.box_pub) || !is32(o.commit))
    return null;
  return o as unknown as Hello;
}

export function parseReveal(v: unknown): Reveal | null {
  const o = parseSigned(v);
  if (!o || !is16(o.request_id) || !is32(o.a_nonce)) return null;
  return o as unknown as Reveal;
}

export function parseStatusAsk(v: unknown): StatusAsk | null {
  const o = parseSigned(v);
  if (!o || !is16(o.request_id)) return null;
  return o as unknown as StatusAsk;
}

export function parseAck(v: unknown): Ack | null {
  const o = obj(v);
  if (!o || !is16(o.request_id) || !is32(o.sign_pub) || !is32(o.box_pub))
    return null;
  if (!is32(o.b_nonce) || typeof o.sig !== "string" || !B64_SIG.test(o.sig))
    return null;
  return o as unknown as Ack;
}

export function parseAnswer(v: unknown): Answer | null {
  const o = obj(v);
  if (!o || !STATES.includes(o.state as LinkState)) return null;
  if (typeof o.sig !== "string" || !B64_SIG.test(o.sig)) return null;
  return o as unknown as Answer;
}

const helloFields = (h: Omit<Hello, "sig" | "v">) => [
  h.from,
  h.to,
  h.ts,
  h.nonce,
  h.sign_pub,
  h.box_pub,
  h.commit,
];

export function signHello(key: KeyObject, h: Omit<Hello, "sig" | "v">): Hello {
  return { v: 1, ...h, sig: signFields(key, D.hello, helloFields(h)) };
}

export const verifyHello = (h: Hello) =>
  verifyFields(h.sign_pub, h.sig, D.hello, helloFields(h));

// The ack names both machines and the hello it answers.
const ackFields = (a: Omit<Ack, "sig">, hello: Hello) => [
  hello.to,
  hello.from,
  hello.nonce,
  a.request_id,
  a.sign_pub,
  a.box_pub,
  a.b_nonce,
];

export function signAck(
  key: KeyObject,
  a: Omit<Ack, "sig">,
  hello: Hello
): Ack {
  return { ...a, sig: signFields(key, D.ack, ackFields(a, hello)) };
}

export const verifyAck = (a: Ack, hello: Hello, bSign: string) =>
  a.sign_pub === bSign &&
  verifyFields(bSign, a.sig, D.ack, ackFields(a, hello));

const revealFields = (r: Omit<Reveal, "sig" | "v">) => [
  r.from,
  r.to,
  r.ts,
  r.nonce,
  r.request_id,
  r.a_nonce,
];

export function signReveal(
  key: KeyObject,
  r: Omit<Reveal, "sig" | "v">
): Reveal {
  return { v: 1, ...r, sig: signFields(key, D.reveal, revealFields(r)) };
}

export const verifyReveal = (r: Reveal, aSign: string) =>
  verifyFields(aSign, r.sig, D.reveal, revealFields(r));

const statusFields = (s: Omit<StatusAsk, "sig" | "v">) => [
  s.from,
  s.to,
  s.ts,
  s.nonce,
  s.request_id,
];

export function signStatusAsk(
  key: KeyObject,
  s: Omit<StatusAsk, "sig" | "v">
): StatusAsk {
  return { v: 1, ...s, sig: signFields(key, D.status, statusFields(s)) };
}

export const verifyStatusAsk = (s: StatusAsk, aSign: string) =>
  verifyFields(aSign, s.sig, D.status, statusFields(s));

/** B's answer to a reveal or a status call, bound to that call. */
const answerFields = (state: LinkState, ask: Reveal | StatusAsk) => [
  ask.to,
  ask.from,
  ask.request_id,
  ask.nonce,
  state,
];

export const signAnswer = (
  key: KeyObject,
  state: LinkState,
  ask: Reveal | StatusAsk
): Answer => ({
  state,
  sig: signFields(key, D.answer, answerFields(state, ask)),
});

export const verifyAnswer = (
  a: Answer,
  ask: Reveal | StatusAsk,
  bSign: string
) => verifyFields(bSign, a.sig, D.answer, answerFields(a.state, ask));

export const withinSkew = (ts: number, now: number) =>
  Math.abs(now - ts) <= SKEW_MS;
