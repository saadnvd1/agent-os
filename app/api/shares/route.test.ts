import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// A fake Connect that verifies each signed request against the machine's key.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-share-route-"));
const keys = crypto.generateKeyPairSync("ed25519");
const publicPem = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const privatePem = keys.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const MACHINE = "abcd1234";
const HOST = "m-0123456789abcdef.runagentos.com";

interface Seen {
  method: string;
  url: string;
  body: string;
  signed: boolean;
}
let seen: Seen[] = [];
let down = false;
let remote: Record<string, unknown>[] = [];
const server = http.createServer((req, res) => {
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
    const signed = crypto.verify(
      null,
      Buffer.from(message),
      publicPem,
      Buffer.from(h("x-connect-signature"), "base64url")
    );
    seen.push({ method: req.method!, url: req.url!, body, signed });
    const send = (code: number, json: unknown) =>
      res
        .writeHead(code, { "Content-Type": "application/json" })
        .end(JSON.stringify(json));
    if (!signed) return send(401, { error: "bad signature" });
    if (down) return send(503, { error: "down" });
    const base = `/api/v1/machines/${MACHINE}/shares`;
    if (req.method === "POST" && req.url === base) {
      const b = JSON.parse(body);
      const s = {
        id: "abcdefghijkl",
        kind: b.kind,
        title: b.title,
        status: "active",
        byte_size: body.length,
        view_count: 0,
        last_viewed_at: null,
        created_at: new Date().toISOString(),
        expires_at:
          b.expires_in === "never"
            ? null
            : new Date(Date.now() + 7 * 864e5).toISOString(),
      };
      remote = [{ ...s, view_count: 3 }];
      return send(201, {
        ...s,
        url: `https://runagentos.com/s/${"T".repeat(32)}`,
      });
    }
    if (req.method === "GET" && req.url === base)
      return send(200, { shares: remote });
    if (req.method === "DELETE" && req.url === `${base}/abcdefghijkl`) {
      remote = remote.map((s) => ({ ...s, status: "revoked" }));
      return send(200, remote[0]);
    }
    send(404, { error: "no such share" });
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.AGENTOS_CONNECT_DIR = dir;
process.env.CONNECT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.AGENTOS_CONNECT_OPERATOR = "1";
process.env.AGENTOS_ARTIFACTS_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "agentos-share-art-")
);

const link = () => {
  fs.writeFileSync(
    path.join(dir, "connect.json"),
    JSON.stringify({
      machineId: MACHINE,
      hostname: HOST,
      apiUrl: process.env.CONNECT_API_URL,
      enabled: true,
    }),
    { mode: 0o600 }
  );
  fs.writeFileSync(path.join(dir, "machine.key"), privatePem, { mode: 0o600 });
};
const unlink = () => {
  for (const f of ["connect.json", "machine.key"])
    fs.rmSync(path.join(dir, f), { force: true });
};

const shares = await import("./route");
const preview = await import("./preview/route");
const one = await import("./[id]/route");
const { saveItem } = await import("@/lib/chat/store");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");
const { createArtifact } = await import("@/lib/artifacts/store");
const { getDb } = await import("@/lib/db");

const secret = ["gh", "p_", "b".repeat(36)].join("");
const home = os.homedir();
const tailnet = ["box", "example-net", "ts", "net"].join(".");

const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function chat() {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  const id = seedSession({
    projectId: project.id,
    name: "Share me",
    view: "chat",
  });
  let t = 0;
  const add = (item: Record<string, unknown>) =>
    saveItem(id, { createdAt: ++t, ...item } as never);
  add({
    id: "u1",
    kind: "user",
    text: `key ${secret} in ${home}/app on ${tailnet}`,
  });
  add({ id: "a1", kind: "assistant", text: "ok" });
  return id;
}

beforeEach(() => {
  seen = [];
  down = false;
  remote = [];
  getDb().prepare(`DELETE FROM shared_links`).run();
  link();
});
afterAll(() => {
  server.close();
  unlink();
});

describe("preview", () => {
  it("shows the redacted page and never calls Connect", async () => {
    const id = chat();
    const res = await preview.POST(
      post("/api/shares/preview", {
        kind: "chat",
        sessionId: id,
        includeTools: false,
      })
    );
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(p.connectLinked).toBe(true);
    expect(p.html).not.toContain(secret);
    expect(p.html).not.toContain(home);
    expect(p.html).not.toContain(tailnet);
    expect(p.html).toContain("[secret]");
    expect(p.hits).toMatchObject({ secret: 1, path: 1, host: 1 });
    expect(p.items.map((i: { id: string }) => i.id)).toEqual(["u1", "a1"]);
    expect(seen).toHaveLength(0);
  });

  it("refuses the demo, a bad body and an unknown chat", async () => {
    process.env.AGENTOS_DEMO = "1";
    expect((await preview.POST(post("/api/shares/preview", {}))).status).toBe(
      403
    );
    delete process.env.AGENTOS_DEMO;
    expect(
      (await preview.POST(post("/api/shares/preview", { kind: "x" }))).status
    ).toBe(400);
    expect(
      (
        await preview.POST(
          post("/api/shares/preview", { kind: "chat", sessionId: "nope" })
        )
      ).status
    ).toBe(404);
  });

  it("rejects a body over the cap", async () => {
    const res = await preview.POST(
      post("/api/shares/preview", {
        kind: "chat",
        sessionId: "x".repeat(70_000),
      })
    );
    expect(res.status).toBe(413);
  });
});

describe("create", () => {
  async function previewOf(id: string, extra = {}) {
    const res = await preview.POST(
      post("/api/shares/preview", {
        kind: "chat",
        sessionId: id,
        includeTools: false,
        ...extra,
      })
    );
    return res.json();
  }

  it("uploads exactly what was previewed, redacted, signed, and keeps the link", async () => {
    const id = chat();
    const p = await previewOf(id);
    const res = await shares.POST(
      post("/api/shares", {
        kind: "chat",
        sessionId: id,
        includeTools: false,
        sharedAt: p.sharedAt,
        hash: p.hash,
        expiresIn: "7d",
      })
    );
    expect(res.status).toBe(201);
    const made = await res.json();
    expect(made.url).toMatch(/^https:\/\/runagentos\.com\/s\/T{32}$/);
    const upload = seen.find((s) => s.method === "POST")!;
    expect(upload.signed).toBe(true);
    const sent = JSON.parse(upload.body);
    expect(sent).toMatchObject({
      kind: "chat",
      title: "Share me",
      expires_in: "7d",
      html: p.html,
    });
    for (const leak of [secret, home, tailnet])
      expect(upload.body).not.toContain(leak);
    const listed = await (await shares.GET()).json();
    expect(listed.shares[0]).toMatchObject({
      id: made.id,
      url: made.url,
      sessionId: id,
      status: "active",
      views: 3,
    });
  });

  it("refuses when the page changed since the preview, uploading nothing", async () => {
    const id = chat();
    const p = await previewOf(id);
    saveItem(id, {
      id: "a2",
      kind: "assistant",
      text: "later",
      createdAt: 99,
    } as never);
    const res = await shares.POST(
      post("/api/shares", {
        kind: "chat",
        sessionId: id,
        includeTools: false,
        sharedAt: p.sharedAt,
        hash: p.hash,
        expiresIn: "7d",
      })
    );
    expect(res.status).toBe(409);
    expect(seen).toHaveLength(0);
  });

  it("respects the messages dropped in the preview", async () => {
    const id = chat();
    const p = await previewOf(id, { dropIds: ["u1"] });
    expect(p.html).not.toContain("[secret]");
    const res = await shares.POST(
      post("/api/shares", {
        kind: "chat",
        sessionId: id,
        includeTools: false,
        dropIds: ["u1"],
        sharedAt: p.sharedAt,
        hash: p.hash,
        expiresIn: "never",
      })
    );
    expect(res.status).toBe(201);
    expect(JSON.parse(seen[0].body).expires_in).toBe("never");
  });

  it("shares an artifact", async () => {
    const id = chat();
    const art = createArtifact(
      id,
      "Chart",
      `<html><head></head><body>${secret}</body></html>`
    );
    const body = { kind: "artifact", artifactId: art.id };
    const p = await (
      await preview.POST(post("/api/shares/preview", body))
    ).json();
    const res = await shares.POST(
      post("/api/shares", {
        ...body,
        sharedAt: p.sharedAt,
        hash: p.hash,
        expiresIn: "1d",
      })
    );
    expect(res.status).toBe(201);
    const html = JSON.parse(seen[0].body).html as string;
    expect(html).not.toContain(secret);
    expect(html).toContain("noindex");
  });

  it("says so when Connect isn't linked, and for a bad expiry or hash", async () => {
    const id = chat();
    const p = await previewOf(id);
    const body = {
      kind: "chat",
      sessionId: id,
      includeTools: false,
      sharedAt: p.sharedAt,
      hash: p.hash,
    };
    expect(
      (
        await shares.POST(
          post("/api/shares", { ...body, expiresIn: "forever" })
        )
      ).status
    ).toBe(400);
    expect(
      (await shares.POST(post("/api/shares", { ...body, hash: undefined })))
        .status
    ).toBe(400);
    unlink();
    const res = await shares.POST(
      post("/api/shares", { ...body, expiresIn: "7d" })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Connect/);
    expect(seen).toHaveLength(0);
  });

  it("maps a Connect failure to a message, and refuses the demo", async () => {
    const id = chat();
    const p = await previewOf(id);
    down = true;
    const body = {
      kind: "chat",
      sessionId: id,
      includeTools: false,
      sharedAt: p.sharedAt,
      hash: p.hash,
      expiresIn: "7d",
    };
    expect((await shares.POST(post("/api/shares", body))).status).toBe(502);
    process.env.AGENTOS_DEMO = "1";
    expect((await shares.POST(post("/api/shares", body))).status).toBe(403);
    delete process.env.AGENTOS_DEMO;
  });
});

describe("list and revoke", () => {
  async function made() {
    const id = chat();
    const p = await (
      await preview.POST(
        post("/api/shares/preview", { kind: "chat", sessionId: id })
      )
    ).json();
    const res = await shares.POST(
      post("/api/shares", {
        kind: "chat",
        sessionId: id,
        sharedAt: p.sharedAt,
        hash: p.hash,
        expiresIn: "7d",
      })
    );
    return (await res.json()).id as string;
  }

  it("falls back to the local rows when Connect is down", async () => {
    await made();
    down = true;
    const listed = await (await shares.GET()).json();
    expect(listed.connect).toBe("unavailable");
    unlink();
    expect((await (await shares.GET()).json()).connect).toBe("unlinked");
    link();
    expect(listed.shares[0]).toMatchObject({ views: null, status: "active" });
  });

  it("revokes on Connect and marks the row", async () => {
    const id = await made();
    const res = await one.DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const del = seen.find((s) => s.method === "DELETE")!;
    expect(del.signed).toBe(true);
    const listed = await (await shares.GET()).json();
    expect(listed.shares[0].status).toBe("revoked");
    const row = getDb()
      .prepare(`SELECT revoked_at FROM shared_links WHERE id = ?`)
      .get(id) as { revoked_at: string };
    expect(row.revoked_at).toBeTruthy();
  });

  it("404s an unknown link and keeps the row when Connect fails", async () => {
    expect(
      (
        await one.DELETE(new Request("http://localhost"), {
          params: Promise.resolve({ id: "zzzzzzzzzzzz" }),
        })
      ).status
    ).toBe(404);
    const id = await made();
    down = true;
    expect(
      (
        await one.DELETE(new Request("http://localhost"), {
          params: Promise.resolve({ id }),
        })
      ).status
    ).toBe(502);
    const row = getDb()
      .prepare(`SELECT revoked_at FROM shared_links WHERE id = ?`)
      .get(id) as { revoked_at: string | null };
    expect(row.revoked_at).toBeNull();
  });
});
