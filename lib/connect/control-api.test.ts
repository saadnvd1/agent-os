import { describe, it, expect, afterAll } from "vitest";
import crypto from "crypto";
import fs from "fs";
import http, { type IncomingMessage } from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import {
  checkApiUrl,
  clean,
  enrolled,
  registerWithCode,
  requestTunnel,
  signedHeaders,
} from "./control-api";
import { enrol, machineKeys } from "./enrol";

const HOST = "m-3f9a1c07d2b84e61.runagentos.com";
// Shaped like a connector token (base64 of JSON); made per run, never real.
const fakeToken = () =>
  Buffer.from(
    JSON.stringify({
      a: crypto.randomBytes(16).toString("hex"),
      t: crypto.randomUUID(),
      s: crypto.randomBytes(32).toString("base64"),
    })
  ).toString("base64");
const newKey = () =>
  crypto
    .generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();

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

  // The control plane, as docs/machine-api.md describes it.
  async function controlPlane() {
    const keys = new Map<string, string>();
    const seen = new Set<string>();
    const asked: { path: string; body: Record<string, unknown> }[] = [];
    let token = fakeToken();
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const json = (status: number, v: unknown) =>
          res
            .writeHead(status, { "Content-Type": "application/json" })
            .end(JSON.stringify(v));
        const b = body ? JSON.parse(body) : {};
        asked.push({ path: req.url!, body: b });
        if (req.url === "/api/v1/machines/enrol") {
          if (b.link_code !== "ABCD-EFGH")
            return json(404, { error: "unknown code" });
          for (const [id, k] of keys)
            if (k === b.public_key)
              return json(409, { error: "already linked", machine_id: id });
          keys.set("k7q2mz9x", b.public_key);
          return json(201, {
            machine_id: "k7q2mz9x",
            hostname: HOST,
            tunnel_token: token,
          });
        }
        if (req.url === "/api/v1/machines/k7q2mz9x/tunnel") {
          if (!verify(req, body, keys.get("k7q2mz9x") ?? "", seen))
            return json(401, { error: "bad signature" });
          token = fakeToken();
          return json(200, { hostname: HOST, tunnel_token: token });
        }
        res.writeHead(404).end();
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { api, asked, token: () => token };
  }

  it("enrols with a link code and its tunnel port, saving only id, name and service", async () => {
    const cp = await controlPlane();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-api-"));

    await expect(
      enrol({
        dir,
        register: registerWithCode(cp.api, "WRONG-CODE", "Mac", 3444),
      })
    ).rejects.toThrow("unknown code");

    const config = await enrol({
      dir,
      register: registerWithCode(cp.api, "ABCD-EFGH", "Mac", 3444),
    });
    expect(config).toEqual({
      machineId: "k7q2mz9x",
      hostname: HOST,
      apiUrl: cp.api,
    });
    expect(cp.asked.at(-1)?.body).toMatchObject({
      link_code: "ABCD-EFGH",
      name: "Mac",
      port: 3444,
    });
    expect(String(cp.asked.at(-1)?.body.public_key)).toContain(
      "BEGIN PUBLIC KEY"
    );
    // The connector token is never written down.
    for (const f of fs.readdirSync(dir)) {
      expect(fs.readFileSync(path.join(dir, f), "utf8")).not.toContain(
        cp.token()
      );
      expect(fs.statSync(path.join(dir, f)).mode & 0o777).toBe(0o600);
    }
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("relinks a key the account already has through the signed tunnel endpoint", async () => {
    const cp = await controlPlane();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-api-"));
    await enrol({
      dir,
      register: registerWithCode(cp.api, "ABCD-EFGH", "Mac", 3444),
    });
    fs.rmSync(path.join(dir, "connect.json"));

    const again = await enrol({
      dir,
      register: registerWithCode(cp.api, "ABCD-EFGH", "Mac", 3555),
    });
    expect(again).toEqual({
      machineId: "k7q2mz9x",
      hostname: HOST,
      apiUrl: cp.api,
    });
    expect(cp.asked.slice(-2).map((a) => a.path)).toEqual([
      "/api/v1/machines/enrol",
      "/api/v1/machines/k7q2mz9x/tunnel",
    ]);
    expect(cp.asked.at(-1)?.body).toEqual({ port: 3555 });
  });

  it("gets a fresh token on every signed ask, and only for the machine's own key", async () => {
    const cp = await controlPlane();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-api-"));
    const config = await enrol({
      dir,
      register: registerWithCode(cp.api, "ABCD-EFGH", "Mac", 3444),
    });
    const { privateKey } = machineKeys(dir);
    const first = await requestTunnel(config, privateKey, 3444);
    const second = await requestTunnel(config, privateKey, 3444);
    expect(first.hostname).toBe(HOST);
    expect(first.token).not.toBe(second.token);
    expect(second.token).toBe(cp.token());
    // Someone else's key can't speak for this machine.
    await expect(requestTunnel(config, newKey(), 3444)).rejects.toThrow(
      "bad signature"
    );
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

  async function serve(handler: http.RequestListener): Promise<string> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("never follows a redirect, so the code and signatures stay put", async () => {
    let leaked = "";
    const elsewhere = await serve((req, res) => {
      req.on("data", (c) => (leaked += c));
      req.on("end", () => res.writeHead(201).end("{}"));
    });
    const api = await serve((_req, res) =>
      res.writeHead(307, { Location: `${elsewhere}/steal` }).end()
    );
    const keys = { publicKey: "pk", privateKey: newKey() };
    await expect(
      registerWithCode(api, "ABCD-EFGH", "Mac", 3444)(keys)
    ).rejects.toThrow();
    const config = { machineId: "k7q2mz9x", hostname: HOST, apiUrl: api };
    await expect(
      requestTunnel(config, keys.privateKey, 3444)
    ).rejects.toThrow();
    expect(leaked).toBe("");
  });

  it("accepts only m-<16 hex>.runagentos.com and a token-shaped token", async () => {
    const ok = { machine_id: "k7q2mz9x", hostname: HOST, tunnel_token: null };
    expect(enrolled(ok, "https://x")).toEqual({
      machineId: "k7q2mz9x",
      hostname: HOST,
      apiUrl: "https://x",
    });
    for (const bad of [
      { ...ok, machine_id: "../../x" },
      { ...ok, machine_id: "K7Q2MZ9X" },
      { ...ok, hostname: "k7q2mz9x.on.runagentos.com" },
      { ...ok, hostname: "app.runagentos.com" },
      { ...ok, hostname: "mail.runagentos.com" },
      { ...ok, hostname: `${HOST}.evil.com` },
      { ...ok, hostname: `evil.${HOST}` },
      { ...ok, hostname: "m-3F9A1C07D2B84E61.runagentos.com" },
      { ...ok, hostname: "m-3f9a1c07d2b84e6.runagentos.com" },
      { ...ok, hostname: 7 },
      null,
    ])
      expect(() => enrolled(bad, "https://x")).toThrow();

    let answer: Record<string, unknown> = {};
    const api = await serve((_req, res) =>
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(answer))
    );
    const config = { machineId: "k7q2mz9x", hostname: "", apiUrl: api };
    for (const bad of [
      { hostname: HOST },
      { hostname: HOST, tunnel_token: "" },
      { hostname: HOST, tunnel_token: "short" },
      { hostname: HOST, tunnel_token: `${fakeToken()}\nevil` },
      { hostname: "victim.runagentos.com", tunnel_token: fakeToken() },
    ]) {
      answer = bad;
      await expect(requestTunnel(config, newKey(), 3444)).rejects.toThrow();
    }
    await expect(
      requestTunnel({ ...config, machineId: "../x" }, newKey(), 3444)
    ).rejects.toThrow("invalid machine id");
  });

  it("needs https with no userinfo; local http only for operators", () => {
    expect(checkApiUrl("https://runagentos.com/", false)).toBe(
      "https://runagentos.com"
    );
    expect(() => checkApiUrl("http://runagentos.com", false)).toThrow();
    expect(() => checkApiUrl("https://u:p@runagentos.com", false)).toThrow();
    expect(() => checkApiUrl("http://localhost:3600", false)).toThrow();
    expect(checkApiUrl("http://localhost:3600", true)).toBe(
      "http://localhost:3600"
    );
    expect(() => checkApiUrl("http://example.com", true)).toThrow();
    expect(() => checkApiUrl("not a url", true)).toThrow();
  });

  it("prints the server's error without control characters, capped", async () => {
    expect(clean("bad\u001b[2Jcode\r\n")).toBe("bad [2Jcode  ");
    expect(clean("x".repeat(500))).toHaveLength(201);
    const api = await serve((_req, res) =>
      res
        .writeHead(400, { "Content-Type": "application/json" })
        .end(
          JSON.stringify({ error: "\u001b]0;pwned\u0007" + "y".repeat(400) })
        )
    );
    const err = (await registerWithCode(
      api,
      "c",
      "n",
      3444
    )({
      publicKey: "pk",
      privateKey: newKey(),
    }).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toMatch(/[\u0000-\u001f]/);
    expect(err.message.length).toBeLessThanOrEqual(201);
  });
});
