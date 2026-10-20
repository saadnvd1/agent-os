/**
 * The keys a machine uses with its linked peers. The signing key is
 * Connect's machine.key (Ed25519); the box key (X25519) is peer.key next to
 * it, made on first use, owner-only, and never sent to the Connect service.
 * Public keys travel as base64url of their 32 raw bytes.
 */

import crypto, { type KeyObject } from "crypto";
import fs from "fs";
import path from "path";
import { connectDir, readConnect } from "../connect/config";

const RAW = /^[A-Za-z0-9_-]{43}$/;

export const rawPublic = (key: KeyObject): string => {
  const jwk = key.export({ format: "jwk" });
  if (typeof jwk.x !== "string") throw new Error("not an OKP key");
  return jwk.x;
};

function publicFromRaw(raw: string, crv: "Ed25519" | "X25519"): KeyObject {
  if (!RAW.test(raw)) throw new Error(`bad ${crv} public key`);
  const key = crypto.createPublicKey({
    key: { kty: "OKP", crv, x: raw },
    format: "jwk",
  });
  if (key.asymmetricKeyType !== crv.toLowerCase())
    throw new Error(`bad ${crv} public key`);
  return key;
}

export const signPublic = (raw: string) => publicFromRaw(raw, "Ed25519");
export const boxPublic = (raw: string) => publicFromRaw(raw, "X25519");

export interface BoxKey {
  privateKey: KeyObject;
  publicRaw: string;
}

/**
 * Makes sure `p` is this user's and nobody else's: repairs group or other
 * access, refuses one owned by someone else.
 */
function ownerOnly(p: string, mode: number) {
  if (process.platform === "win32") return;
  const st = fs.lstatSync(p);
  if (st.isSymbolicLink()) throw new Error(`${p} is a symlink`);
  if (typeof process.getuid === "function" && st.uid !== process.getuid())
    throw new Error(`${p} belongs to another user`);
  if (st.mode & 0o077) fs.chmodSync(p, mode);
}

/** peer.key, created owner-only if it isn't there yet. */
export function loadBoxKey(dir = connectDir()): BoxKey {
  const file = path.join(dir, "peer.key");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  ownerOnly(dir, 0o700);
  if (!fs.existsSync(file)) {
    const { privateKey } = crypto.generateKeyPairSync("x25519");
    const pem = privateKey.export({ format: "pem", type: "pkcs8" });
    // Written whole under a temp name, then linked in: a crash never leaves
    // a half-written key, and two starts racing keep whichever came first.
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tmp, pem, { mode: 0o600, flag: "wx" });
    try {
      fs.linkSync(tmp, file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  ownerOnly(file, 0o600);
  const privateKey = crypto.createPrivateKey(fs.readFileSync(file, "utf8"));
  if (privateKey.asymmetricKeyType !== "x25519")
    throw new Error(`${file} is not an X25519 key`);
  return {
    privateKey,
    publicRaw: rawPublic(crypto.createPublicKey(privateKey)),
  };
}

export interface Identity {
  machineId: string;
  signKey: KeyObject;
  signPub: string;
}

/** This machine as Connect knows it, or null when it isn't enrolled. */
export function loadIdentity(dir = connectDir()): Identity | null {
  const read = readConnect(dir);
  if (!read.ok) return null;
  const signKey = crypto.createPrivateKey(read.files.machineKey);
  if (signKey.asymmetricKeyType !== "ed25519") return null;
  return {
    machineId: read.files.config.machineId,
    signKey,
    signPub: rawPublic(crypto.createPublicKey(signKey)),
  };
}

const g = globalThis as unknown as {
  __agentosPeerIdentity?: {
    at: number;
    dir: string;
    identity: Identity | null;
  };
};

/** loadIdentity, re-read at most every 30 s (it's on every peer call). */
export function currentIdentity(dir = connectDir()): Identity | null {
  const c = g.__agentosPeerIdentity;
  if (c && c.dir === dir && Date.now() - c.at < 30_000) return c.identity;
  let identity: Identity | null = null;
  try {
    identity = loadIdentity(dir);
  } catch {
    identity = null;
  }
  g.__agentosPeerIdentity = { at: Date.now(), dir, identity };
  return identity;
}
