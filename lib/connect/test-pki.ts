/**
 * Test-only: a throwaway CA and leaf certificates. Shared with the relay.
 *
 * Keys come from Node (named P-256); openssl only signs, with SHA-256 named
 * explicitly. macOS's LibreSSL would otherwise sign with SHA-1 and write EC
 * keys with explicit parameters, both of which TLS refuses.
 */

import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export interface TestPki {
  ca: string;
  leaf(name: string): { key: string; cert: string };
}

export function makeTestPki(): TestPki {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-pki-"));
  const f = (n: string) => path.join(dir, n);
  const ssl = (...args: string[]) =>
    execFileSync("openssl", args, { stdio: "pipe" });
  const newKey = (file: string) => {
    const { privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    fs.writeFileSync(f(file), pem);
    return pem;
  };

  newKey("ca.key");
  ssl(
    "req",
    "-new",
    "-x509",
    "-sha256",
    "-key",
    f("ca.key"),
    "-out",
    f("ca.crt"),
    "-days",
    "1",
    "-subj",
    "/CN=test ca"
  );
  return {
    ca: fs.readFileSync(f("ca.crt"), "utf8"),
    leaf(name) {
      const key = newKey(`${name}.key`);
      ssl(
        "req",
        "-new",
        "-sha256",
        "-key",
        f(`${name}.key`),
        "-out",
        f(`${name}.csr`),
        "-subj",
        `/CN=${name}`
      );
      fs.writeFileSync(f(`${name}.ext`), `subjectAltName=DNS:${name}\n`);
      ssl(
        "x509",
        "-req",
        "-sha256",
        "-in",
        f(`${name}.csr`),
        "-CA",
        f("ca.crt"),
        "-CAkey",
        f("ca.key"),
        "-CAcreateserial",
        "-out",
        f(`${name}.crt`),
        "-days",
        "1",
        "-extfile",
        f(`${name}.ext`)
      );
      return { key, cert: fs.readFileSync(f(`${name}.crt`), "utf8") };
    },
  };
}
