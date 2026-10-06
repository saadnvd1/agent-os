// Tests only: a software WebAuthn authenticator (P-256), so the real
// assertion checks run without a browser.

import crypto from "crypto";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { addPasskey, markBootstrapped, type PasskeyRow } from "./passkeys";

const b64url = (b: Buffer) => b.toString("base64url");

export function softAuthenticator(rpId = "localhost") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  // COSE_Key {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(jwk.y, "base64url"),
  ]);
  const id = b64url(crypto.randomBytes(16));
  let count = 0;

  return {
    id,
    // As a verified registration would: stored, and the free first one used.
    register(name = "Test key"): PasskeyRow {
      markBootstrapped();
      return addPasskey({
        id,
        publicKey: cose,
        counter: 0,
        rpId,
        name,
        via: "loopback",
        from: "this machine",
        userAgent: null,
      });
    },
    // An assertion for the given challenge; `verified: false` leaves out
    // user verification, as a bare security-key tap would.
    assert(
      challenge: string,
      opts: { origin?: string; verified?: boolean } = {}
    ): AuthenticationResponseJSON {
      const clientData = Buffer.from(
        JSON.stringify({
          type: "webauthn.get",
          challenge,
          origin: opts.origin ?? "http://localhost:3011",
          crossOrigin: false,
        })
      );
      const counter = Buffer.alloc(4);
      counter.writeUInt32BE(++count);
      const authData = Buffer.concat([
        crypto.createHash("sha256").update(rpId).digest(),
        Buffer.from([opts.verified === false ? 0x01 : 0x05]),
        counter,
      ]);
      const signature = crypto.sign(
        "sha256",
        Buffer.concat([
          authData,
          crypto.createHash("sha256").update(clientData).digest(),
        ]),
        privateKey
      );
      return {
        id,
        rawId: id,
        type: "public-key",
        response: {
          clientDataJSON: b64url(clientData),
          authenticatorData: b64url(authData),
          signature: b64url(signature),
        },
        clientExtensionResults: {},
      };
    },
  };
}
