import { describe, it, expect, afterAll } from "vitest";
import crypto from "crypto";
import fs from "fs";
import http, { type IncomingMessage } from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { brokerDns, registerWithCode, signedHeaders } from "./control-api";
import { enrol } from "./enrol";

// A control plane that checks requests exactly as docs/machine-api.md says.
function verify(
  req: IncomingMessage,
  body: string,
  publicKey: string,
  seen: Set<string>
): boolean {
  const h = (k: string) => String(req.headers[k] ?? "");
  const ts = Number(h("x-connect-timestamp"));
  if (Math.abs(Date.now() - ts) > 60_000 || seen.has(h("x-connect-nonce")))
    return false;
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  const message = [
    "agentos-connect-api",
    req.method,
    req.url,
    h("x-connect-timestamp"),
    h("x-connect-nonce"),
    digest,
  ].join("\n");
  const ok = crypto.verify(
    null,
    Buffer.from(message),
    publicKey,
    Buffer.from(h("x-connect-signature"), "base64url")
  );
  if (ok) seen.add(h("x-connect-nonce"));
  return ok;
}

describe("control plane API client", () => {
  const servers: http.Server[] = [];
  afterAll(() => servers.forEach((s) => s.close()));

  it("enrols with a link code, then asks the broker for only its own challenge, signed", async () => {
    const keys = new Map<string, string>();
    const seen = new Set<string>();
    const txt: string[] = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/api/v1/machines/enrol") {
          const b = JSON.parse(body);
          if (b.link_code !== "ABCD-EFGH")
            return res.writeHead(404).end('{"error":"unknown code"}');
          keys.set("k7q2mz9x", b.public_key);
          res.writeHead(201, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({
              machine_id: "k7q2mz9x",
              hostname: "k7q2mz9x.on.test",
              relay_url: "wss://relay.test",
            })
          );
        }
        if (req.url === "/api/v1/machines/k7q2mz9x/acme-challenge") {
          if (!verify(req, body, keys.get("k7q2mz9x")!, seen))
            return res.writeHead(401).end();
          const b = JSON.parse(body);
          if (b.name !== "_acme-challenge.k7q2mz9x.on.test")
            return res.writeHead(403).end();
          txt.push(`${req.method} ${b.value}`);
          return res.writeHead(204).end();
        }
        res.writeHead(404).end();
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-api-"));

    await expect(
      enrol({
        domain: "on.test",
        relayUrl: "x",
        dir,
        register: registerWithCode(api, "WRONG-CODE", "Mac"),
      })
    ).rejects.toThrow("unknown code");

    const { config } = await enrol({
      domain: "on.test",
      relayUrl: "x",
      dir,
      register: registerWithCode(api, "ABCD-EFGH", "Mac"),
    });
    expect(config).toMatchObject({
      machineId: "k7q2mz9x",
      hostname: "k7q2mz9x.on.test",
      apiUrl: api,
    });
    const privateKey = fs.readFileSync(path.join(dir, "machine.key"), "utf8");

    const dns = brokerDns(config, privateKey);
    await dns.clear("_acme-challenge.k7q2mz9x.on.test", "v1");
    expect(txt).toEqual(["DELETE v1"]);
    await expect(
      dns.clear("_acme-challenge.other.on.test", "v1")
    ).rejects.toThrow("403");
    // Someone else's key can't speak for this machine.
    const stranger = crypto
      .generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    await expect(
      brokerDns(config, stranger).clear(
        "_acme-challenge.k7q2mz9x.on.test",
        "v1"
      )
    ).rejects.toThrow("401");
  });

  it("signs method, path, time, nonce and body together", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const h = signedHeaders({
      machineId: "m",
      privateKey: pem,
      method: "post",
      path: "/p",
      body: "{}",
      now: 1,
      nonce: "n",
    });
    const message = [
      "agentos-connect-api",
      "POST",
      "/p",
      "1",
      "n",
      crypto.createHash("sha256").update("{}").digest("hex"),
    ].join("\n");
    expect(
      crypto.verify(
        null,
        Buffer.from(message),
        publicKey,
        Buffer.from(h["X-Connect-Signature"], "base64url")
      )
    ).toBe(true);
    const tampered = message.replace("/p", "/q");
    expect(
      crypto.verify(
        null,
        Buffer.from(tampered),
        publicKey,
        Buffer.from(h["X-Connect-Signature"], "base64url")
      )
    ).toBe(false);
  });
});
