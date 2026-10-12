import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { relaySend } from "./relay";
import type { PushRequestBody } from "@/lib/connect/control-api";

const keys = crypto.generateKeyPairSync("ed25519");
const publicPem = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const privatePem = keys.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const ID = "abcd1234";

let answer: { status: number; body: unknown } = { status: 200, body: {} };
let seen: { path: string; body: string; signed: boolean } | null = null;
let server: http.Server;
let dir: string;
const saved = { dir: process.env.AGENTOS_CONNECT_DIR };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const h = (k: string) => String(req.headers[k] ?? "");
      const message = [
        "agentos-connect-api",
        req.method,
        req.url,
        h("x-connect-timestamp"),
        h("x-connect-nonce"),
        crypto.createHash("sha256").update(body).digest("hex"),
      ].join("\n");
      seen = {
        path: req.url ?? "",
        body,
        signed:
          h("x-connect-machine") === ID &&
          crypto.verify(
            null,
            Buffer.from(message),
            publicPem,
            Buffer.from(h("x-connect-signature"), "base64url")
          ),
      };
      res.writeHead(answer.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-relay-"));
  fs.writeFileSync(
    path.join(dir, "connect.json"),
    JSON.stringify({
      machineId: ID,
      apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    })
  );
  fs.writeFileSync(path.join(dir, "machine.key"), privatePem);
  process.env.AGENTOS_CONNECT_DIR = dir;
});
afterAll(() => {
  server.close();
  if (saved.dir === undefined) delete process.env.AGENTOS_CONNECT_DIR;
  else process.env.AGENTOS_CONNECT_DIR = saved.dir;
});
beforeEach(() => {
  seen = null;
  answer = { status: 200, body: {} };
});

const body: PushRequestBody = {
  v: 1,
  devices: [{ token: "ab".repeat(32), env: "production" }],
  push_type: "alert",
  priority: 10,
  level: "active",
  collapse_id: "c".repeat(32),
  thread_id: "review",
  payload: { v: 1 },
};

describe("relaySend", () => {
  it("posts the body, signed with the machine key, to the machine's push path", async () => {
    answer = {
      status: 200,
      body: { results: [{ status: "sent", apns_status: 200 }] },
    };
    const out = await relaySend(body);
    expect(out).toEqual({
      kind: "results",
      results: [{ status: "sent", apns_status: 200 }],
    });
    expect(seen).toMatchObject({
      path: `/api/v1/machines/${ID}/push`,
      signed: true,
    });
    expect(JSON.parse(seen!.body)).toEqual(body);
  });

  it("503 push_not_configured is 'unavailable', in plain words", async () => {
    answer = { status: 503, body: { error: "push_not_configured" } };
    expect(await relaySend(body)).toEqual({
      kind: "unavailable",
      reason: "push isn't set up on the Connect service yet",
    });
  });

  it("an unsigned or disabled machine is unavailable; a bad body is invalid; rate limit and server errors retry", async () => {
    for (const [status, kind] of [
      [401, "unavailable"],
      [403, "unavailable"],
      [400, "invalid"],
      [413, "invalid"],
      [429, "retry"],
      [500, "retry"],
    ] as const) {
      answer = { status, body: { error: "nope" } };
      expect((await relaySend(body)).kind, String(status)).toBe(kind);
    }
  });

  it("an answer with no results is a retry, not a success", async () => {
    answer = { status: 200, body: { ok: true } };
    expect((await relaySend(body)).kind).toBe("retry");
  });

  it("a machine that isn't linked is unavailable without any call", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "aos-relay-none-"));
    process.env.AGENTOS_CONNECT_DIR = empty;
    try {
      expect(await relaySend(body)).toEqual({
        kind: "unavailable",
        reason: "this machine isn't linked to Connect",
      });
      expect(seen).toBeNull();
    } finally {
      process.env.AGENTOS_CONNECT_DIR = dir;
    }
  });
});
