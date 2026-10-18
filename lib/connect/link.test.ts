import { afterAll, afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import http from "http";
import path from "path";
import type { AddressInfo } from "net";
import { cleanLinkCode, linkWithCode } from "./link";
import { tempDir } from "@/lib/test-temp";

const HOST = "m-0123456789abcdef.runagentos.com";
const servers: http.Server[] = [];
afterAll(() => servers.forEach((s) => s.close()));

async function service() {
  const seen: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b = JSON.parse(body || "{}");
      seen.push(b);
      const json = (status: number, v: unknown) =>
        res
          .writeHead(status, { "Content-Type": "application/json" })
          .end(JSON.stringify(v));
      if (b.link_code !== "GOOD-CODE")
        return json(422, { error: "code expired" });
      json(201, { machine_id: "abcd1234", hostname: HOST });
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    seen,
    env: {
      CONNECT_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      AGENTOS_CONNECT_OPERATOR: "1",
    } as unknown as NodeJS.ProcessEnv,
  };
}

// Each dir holds a machine.key: removed as soon as its test ends.
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const dir = tempDir("agentos-link-");
  dirs.push(dir);
  return dir;
};

describe("linkWithCode", () => {
  it("links, keeps the key owner-only and sends only the public half", async () => {
    const { seen, env } = await service();
    const dir = tmp();
    const config = await linkWithCode({
      code: "GOOD-CODE",
      name: "Studio",
      port: 3444,
      dir,
      env,
    });
    expect(config).toMatchObject({ machineId: "abcd1234", hostname: HOST });
    expect(fs.statSync(path.join(dir, "machine.key")).mode & 0o777).toBe(0o600);
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, "connect.json"), "utf8"))
    ).toMatchObject({ machineId: "abcd1234", hostname: HOST });
    expect(seen[0]).toMatchObject({ name: "Studio", port: 3444 });
    expect(JSON.stringify(seen[0])).not.toContain("PRIVATE KEY");
  });

  it("writes nothing when the service refuses the code", async () => {
    const { env } = await service();
    const dir = tmp();
    await expect(
      linkWithCode({ code: "bad", name: "x", port: 3444, dir, env })
    ).rejects.toThrow("code expired");
    expect(fs.existsSync(path.join(dir, "connect.json"))).toBe(false);
  });

  it("refuses a plain-http service unless an operator asks", async () => {
    const { env } = await service();
    await expect(
      linkWithCode({
        code: "GOOD-CODE",
        name: "x",
        port: 3444,
        dir: tmp(),
        env: { ...env, AGENTOS_CONNECT_OPERATOR: "" },
      })
    ).rejects.toThrow(/https/);
  });
});

describe("cleanLinkCode", () => {
  it("trims a code and rejects what can't be one", () => {
    expect(cleanLinkCode("  ABCD-EFGH \n")).toBe("ABCD-EFGH");
    for (const bad of [
      undefined,
      5,
      "",
      "   ",
      "a b",
      "a\u0000b",
      "x".repeat(129),
    ])
      expect(cleanLinkCode(bad)).toBeNull();
  });
});
