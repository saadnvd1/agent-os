import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import type { AddressInfo } from "net";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "@/lib/test-temp";

const dir = tempDir("agentos-follow-");
const keys = crypto.generateKeyPairSync("ed25519");
const MACHINE = "abcd1234";

let puts: { url: string; body: Record<string, string> }[] = [];
let status = 200;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.method === "PUT")
      puts.push({ url: req.url!, body: JSON.parse(body) });
    res
      .writeHead(status, { "Content-Type": "application/json" })
      .end(JSON.stringify(status === 200 ? { id: "x" } : { error: "no" }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.AGENTOS_CONNECT_DIR = dir;
process.env.AGENTOS_ARTIFACTS_DIR = tempDir("agentos-follow-art-");
fs.writeFileSync(
  path.join(dir, "connect.json"),
  JSON.stringify({
    machineId: MACHINE,
    hostname: "m-0123456789abcdef.runagentos.com",
    apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    enabled: true,
  }),
  { mode: 0o600 }
);
fs.writeFileSync(
  path.join(dir, "machine.key"),
  keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  { mode: 0o600 }
);

const { saveArtifact } = await import("@/lib/artifacts/store");
const { insertSharedLink, getSharedLink } = await import("./store");
const { followLatest } = await import("./follow");
const { getDb } = await import("@/lib/db");

const secret = ["gh", "p_", "c".repeat(36)].join("");
const page = (s: string) => `<html><head></head><body>${s}</body></html>`;
let n = 0;
function link(artifactId: string, version: number, follow: boolean) {
  const id = `link${String(++n).padStart(8, "0")}`;
  insertSharedLink({
    id,
    url: `https://runagentos.com/s/${id}`,
    kind: "artifact",
    title: "Doc",
    session_id: null,
    artifact_id: artifactId,
    expires_at: null,
    created_at: new Date().toISOString(),
    revoked_at: null,
    follow_latest: follow ? 1 : 0,
    version,
  });
  return id;
}

beforeEach(() => {
  puts = [];
  status = 200;
  getDb().prepare(`DELETE FROM shared_links`).run();
});
afterAll(() => server.close());

describe("followLatest", () => {
  it("replaces only follow-latest links of that page, redacted", async () => {
    const a1 = saveArtifact("s1", "A", page("one"), {
      sameTitle: true,
    }).artifact;
    const b1 = saveArtifact("s1", "B", page("other"), {
      sameTitle: true,
    }).artifact;
    const follows = link(a1.id, 1, true);
    const pinned = link(a1.id, 1, false);
    const otherPage = link(b1.id, 1, true);
    const a2 = saveArtifact("s1", "A", page(`two ${secret}`), {
      sameTitle: true,
    }).artifact;
    await followLatest(a2.page_id);
    expect(puts.map((p) => p.url)).toEqual([
      `/api/v1/machines/${MACHINE}/shares/${follows}`,
    ]);
    expect(puts[0].body.html).toContain("two");
    expect(puts[0].body.html).not.toContain(secret);
    expect(puts[0].body.markdown).not.toContain(secret);
    expect(getSharedLink(follows)!.version).toBe(2);
    expect(getSharedLink(pinned)!.version).toBe(1);
    expect(getSharedLink(otherPage)!.version).toBe(1);
  });

  it("leaves the link on its old version after a failure, retries on the next one, and never throws", async () => {
    const a1 = saveArtifact("s2", "C", page("one"), {
      sameTitle: true,
    }).artifact;
    const id = link(a1.id, 1, true);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    status = 503;
    const a2 = saveArtifact("s2", "C", page("two"), {
      sameTitle: true,
    }).artifact;
    await expect(followLatest(a2.page_id)).resolves.toBeUndefined();
    expect(getSharedLink(id)).toMatchObject({ version: 1, follow_latest: 1 });
    expect(err).toHaveBeenCalled();

    status = 200;
    puts = [];
    const a3 = saveArtifact("s2", "C", page("three"), {
      sameTitle: true,
    }).artifact;
    await followLatest(a3.page_id);
    expect(puts).toHaveLength(1);
    expect(puts[0].body.html).toContain("three");
    expect(getSharedLink(id)!.version).toBe(3);
    err.mockRestore();
  });

  it("stops following a link Connect no longer has", async () => {
    const a1 = saveArtifact("s3", "D", page("one"), {
      sameTitle: true,
    }).artifact;
    const id = link(a1.id, 1, true);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    status = 410;
    const a2 = saveArtifact("s3", "D", page("two"), {
      sameTitle: true,
    }).artifact;
    await followLatest(a2.page_id);
    expect(getSharedLink(id)!.follow_latest).toBe(0);
    err.mockRestore();
  });

  it("skips revoked links and does nothing when Connect is unlinked", async () => {
    const a1 = saveArtifact("s4", "E", page("one"), {
      sameTitle: true,
    }).artifact;
    const id = link(a1.id, 1, true);
    getDb()
      .prepare(`UPDATE shared_links SET revoked_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
    const a2 = saveArtifact("s4", "E", page("two"), {
      sameTitle: true,
    }).artifact;
    await followLatest(a2.page_id);
    expect(puts).toHaveLength(0);
  });
});
