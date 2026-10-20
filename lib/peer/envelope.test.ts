import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { fakeMachine } from "@/lib/__fixtures__/peer-machine";
import {
  openRequest,
  openResponse,
  parseRequest,
  sealRequest,
  sealResponse,
  verifyHeader,
  HEADER_SIG,
  type OpenDeps,
  type PeerRequest,
} from "./envelope";
import { boxPublic, signPublic } from "./keys";
import { createReplayGuard } from "./replay";

const A = fakeMachine("aaaa1111");
const B = fakeMachine("bbbb2222");
const C = fakeMachine("cccc3333");
const NOW = 1_800_000_000_000;

const request: PeerRequest = {
  method: "POST",
  path: "/api/tasks/t-1/merge",
  query: "",
  contentType: "application/json",
  body: Buffer.from(JSON.stringify({ sha: "abc" })),
};

const seal = (o: { to?: string; now?: number; peerBox?: string } = {}) =>
  sealRequest({
    from: A.machineId,
    to: o.to ?? B.machineId,
    signKey: A.signKey,
    peerBox: boxPublic(o.peerBox ?? B.box.publicRaw),
    request,
    now: o.now ?? NOW,
  });

const deps = (over: Partial<OpenDeps> = {}): OpenDeps => ({
  self: B.machineId,
  boxKey: B.box.privateKey,
  signKeyFor: (id) =>
    id === A.machineId ? signPublic(A.signPub) : "unknown_peer",
  replay: createReplayGuard(),
  now: NOW,
  ...over,
});

const headerOf = (env: Buffer) => {
  const len = env.readUInt32BE(0);
  return {
    len,
    json: JSON.parse(env.subarray(4, 4 + len).toString()) as Record<
      string,
      unknown
    >,
  };
};

/** The envelope with its header swapped for `header`, the rest untouched. */
function withHeader(env: Buffer, header: Record<string, unknown>): Buffer {
  const { len } = headerOf(env);
  const bytes = Buffer.from(JSON.stringify(header));
  const l = Buffer.alloc(4);
  l.writeUInt32BE(bytes.length);
  return Buffer.concat([l, bytes, env.subarray(4 + len)]);
}

describe("request envelope", () => {
  it("round-trips the inner request", () => {
    const sealed = seal();
    const opened = openRequest(sealed.envelope, deps());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.request.method).toBe("POST");
    expect(opened.request.path).toBe(request.path);
    expect(opened.request.body.equals(request.body)).toBe(true);
    expect(opened.resKey.equals(sealed.resKey)).toBe(true);
    expect(opened.header.from).toBe(A.machineId);
  });

  it("never shows the route or body in the clear", () => {
    const { envelope } = seal();
    const text = envelope.toString("latin1");
    expect(text).not.toContain("/api/tasks");
    expect(text).not.toContain("abc");
  });

  it("uses a fresh ephemeral key and nonce per request", () => {
    const a = headerOf(seal().envelope).json;
    const b = headerOf(seal().envelope).json;
    expect(a.epk).not.toBe(b.epk);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it.each([
    ["from", "cccc3333"],
    ["to", "cccc3333"],
    ["ts", NOW + 1],
    ["nonce", crypto.randomBytes(16).toString("base64url")],
    ["epk", fakeMachine("x").box.publicRaw],
    ["v", 2],
  ])("refuses a changed header field: %s", (field, value) => {
    const { envelope } = seal();
    const changed = withHeader(envelope, {
      ...headerOf(envelope).json,
      [field]: value,
    });
    expect(openRequest(changed, deps()).ok).toBe(false);
  });

  it("refuses a header with an extra field", () => {
    const { envelope } = seal();
    const changed = withHeader(envelope, {
      ...headerOf(envelope).json,
      extra: 1,
    });
    expect(openRequest(changed, deps())).toMatchObject({
      ok: false,
      refusal: "bad_envelope",
    });
  });

  it("refuses any flipped byte, header, ciphertext or signature", () => {
    const { envelope } = seal();
    // Every byte past the length prefix; a flipped header byte that still
    // parses must fail the signature, one that doesn't is malformed.
    for (let i = 4; i < envelope.length; i += 7) {
      const bad = Buffer.from(envelope);
      bad[i] ^= 0x01;
      const opened = openRequest(bad, deps());
      expect(opened.ok, `byte ${i}`).toBe(false);
    }
    const lastSig = Buffer.from(envelope);
    lastSig[lastSig.length - 1] ^= 0x80;
    expect(openRequest(lastSig, deps())).toMatchObject({ refusal: "bad_sig" });
    const firstHsig = Buffer.from(envelope);
    firstHsig[4 + headerOf(envelope).len] ^= 0x01;
    expect(openRequest(firstHsig, deps())).toMatchObject({
      refusal: "bad_sig",
    });
    const firstCt = Buffer.from(envelope);
    firstCt[4 + headerOf(envelope).len + HEADER_SIG] ^= 0x01;
    expect(openRequest(firstCt, deps())).toMatchObject({ refusal: "bad_sig" });
  });

  it("signs the header on its own, so the sender is proven before the body", () => {
    const { envelope } = seal();
    const { len } = headerOf(envelope);
    const headerBytes = envelope.subarray(4, 4 + len);
    const hsig = envelope.subarray(4 + len, 4 + len + HEADER_SIG);
    expect(verifyHeader(headerBytes, hsig, signPublic(A.signPub))).toBe(true);
    expect(verifyHeader(headerBytes, hsig, signPublic(C.signPub))).toBe(false);
    const other = Buffer.from(headerBytes);
    other[other.length - 2] ^= 0x01;
    expect(verifyHeader(other, hsig, signPublic(A.signPub))).toBe(false);
    // Not interchangeable with the whole-envelope signature.
    const sig = envelope.subarray(envelope.length - HEADER_SIG);
    expect(verifyHeader(headerBytes, sig, signPublic(A.signPub))).toBe(false);
  });

  it("refuses an envelope for another machine (cross-machine replay)", () => {
    const { envelope } = seal({ to: C.machineId, peerBox: C.box.publicRaw });
    // C's own copy is fine; B must refuse it.
    expect(openRequest(envelope, deps())).toMatchObject({
      ok: false,
      refusal: "wrong_machine",
    });
  });

  it("refuses an envelope whose `to` was rewritten to this machine", () => {
    const { envelope } = seal({ to: C.machineId, peerBox: C.box.publicRaw });
    const changed = withHeader(envelope, {
      ...headerOf(envelope).json,
      to: B.machineId,
    });
    expect(openRequest(changed, deps())).toMatchObject({ refusal: "bad_sig" });
  });

  it("fails to open when sealed to the wrong box key", () => {
    const { envelope } = seal({ peerBox: C.box.publicRaw });
    expect(openRequest(envelope, deps())).toMatchObject({
      ok: false,
      refusal: "bad_envelope",
    });
  });

  it("refuses a signature by a key other than the pinned one", () => {
    const { envelope } = sealRequest({
      from: A.machineId,
      to: B.machineId,
      signKey: C.signKey,
      peerBox: boxPublic(B.box.publicRaw),
      request,
      now: NOW,
    });
    expect(openRequest(envelope, deps())).toMatchObject({ refusal: "bad_sig" });
  });

  it("refuses an unknown sender and a suspended one", () => {
    const { envelope } = seal();
    expect(
      openRequest(envelope, deps({ signKeyFor: () => "unknown_peer" }))
    ).toMatchObject({ refusal: "unknown_peer" });
    expect(
      openRequest(envelope, deps({ signKeyFor: () => "suspended" }))
    ).toMatchObject({ refusal: "suspended" });
  });

  it("refuses the same envelope twice, and stale ones", () => {
    const replay = createReplayGuard();
    const { envelope } = seal();
    expect(openRequest(envelope, deps({ replay })).ok).toBe(true);
    expect(openRequest(envelope, deps({ replay }))).toMatchObject({
      refusal: "replay",
    });
    expect(
      openRequest(seal({ now: NOW - 121_000 }).envelope, deps())
    ).toMatchObject({ refusal: "stale" });
    expect(
      openRequest(seal({ now: NOW + 121_000 }).envelope, deps())
    ).toMatchObject({ refusal: "stale" });
  });

  it("doesn't burn a nonce for an envelope that fails its signature", () => {
    const replay = createReplayGuard();
    const { envelope } = seal();
    const bad = Buffer.from(envelope);
    bad[bad.length - 1] ^= 0x01;
    expect(openRequest(bad, deps({ replay }))).toMatchObject({
      refusal: "bad_sig",
    });
    expect(openRequest(envelope, deps({ replay })).ok).toBe(true);
  });

  it("refuses garbage and truncated envelopes", () => {
    const { envelope } = seal();
    for (const bad of [
      Buffer.alloc(0),
      Buffer.from([0, 0, 0]),
      Buffer.from([0xff, 0xff, 0xff, 0xff, 1, 2, 3]),
      envelope.subarray(0, 40),
      envelope.subarray(0, envelope.length - 70),
    ])
      expect(openRequest(bad, deps())).toMatchObject({
        ok: false,
      });
    expect(parseRequest(Buffer.from("not an envelope at all"))).toBeNull();
  });
});

describe("response envelope", () => {
  const answer = {
    status: 201,
    contentType: "application/json",
    body: Buffer.from('{"ok":true}'),
  };

  it("round-trips for the request it answers", () => {
    const sealed = seal();
    const opened = openRequest(sealed.envelope, deps());
    if (!opened.ok) throw new Error("didn't open");
    const env = sealResponse({
      resKey: opened.resKey,
      nonce: opened.nonce,
      signKey: B.signKey,
      response: answer,
    });
    const got = openResponse({
      envelope: env,
      nonce: sealed.nonce,
      resKey: sealed.resKey,
      peerSign: signPublic(B.signPub),
    });
    expect(got.status).toBe(201);
    expect(got.body.toString()).toBe('{"ok":true}');
  });

  it("never seals two answers to one request under the same key and IV", () => {
    const sealed = seal();
    const answerOnce = () =>
      sealResponse({
        resKey: sealed.resKey,
        nonce: sealed.nonce,
        signKey: B.signKey,
        response: answer,
      });
    const a = answerOnce();
    const b = answerOnce();
    // Same k_res, so the IV is what keeps the keystreams apart.
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
    expect(a.subarray(0, 12).equals(Buffer.alloc(12))).toBe(false);
    expect(a.subarray(12, 30).equals(b.subarray(12, 30))).toBe(false);
    for (const env of [a, b])
      expect(
        openResponse({
          envelope: env,
          nonce: sealed.nonce,
          resKey: sealed.resKey,
          peerSign: signPublic(B.signPub),
        }).status
      ).toBe(201);
  });

  it("refuses an answer to a different request (response swap)", () => {
    const first = seal();
    const second = seal();
    const opened = openRequest(first.envelope, deps());
    if (!opened.ok) throw new Error("didn't open");
    const env = sealResponse({
      resKey: opened.resKey,
      nonce: opened.nonce,
      signKey: B.signKey,
      response: answer,
    });
    expect(() =>
      openResponse({
        envelope: env,
        nonce: second.nonce,
        resKey: second.resKey,
        peerSign: signPublic(B.signPub),
      })
    ).toThrow(/signed/);
    // Even with the right nonce, the other request's key can't open it.
    expect(() =>
      openResponse({
        envelope: env,
        nonce: first.nonce,
        resKey: second.resKey,
        peerSign: signPublic(B.signPub),
      })
    ).toThrow(/decrypt/);
  });

  it("refuses an answer signed by another key", () => {
    const sealed = seal();
    const env = sealResponse({
      resKey: sealed.resKey,
      nonce: sealed.nonce,
      signKey: C.signKey,
      response: answer,
    });
    expect(() =>
      openResponse({
        envelope: env,
        nonce: sealed.nonce,
        resKey: sealed.resKey,
        peerSign: signPublic(B.signPub),
      })
    ).toThrow(/signed/);
  });

  it("refuses a tampered answer", () => {
    const sealed = seal();
    const env = sealResponse({
      resKey: sealed.resKey,
      nonce: sealed.nonce,
      signKey: B.signKey,
      response: answer,
    });
    for (let i = 0; i < env.length; i += 5) {
      const bad = Buffer.from(env);
      bad[i] ^= 0x01;
      expect(() =>
        openResponse({
          envelope: bad,
          nonce: sealed.nonce,
          resKey: sealed.resKey,
          peerSign: signPublic(B.signPub),
        })
      ).toThrow();
    }
  });
});
