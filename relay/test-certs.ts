/** Test-only: a throwaway CA and leaf certificates, minted with openssl. */

import { execFileSync } from "child_process";
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
  const ec = [
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
  ];
  ssl(
    "req",
    "-x509",
    ...ec,
    "-keyout",
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
      ssl(
        "req",
        ...ec,
        "-keyout",
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
      return {
        key: fs.readFileSync(f(`${name}.key`), "utf8"),
        cert: fs.readFileSync(f(`${name}.crt`), "utf8"),
      };
    },
  };
}
