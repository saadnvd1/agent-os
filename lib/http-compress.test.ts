import { createServer, request, type Server } from "http";
import { gunzipSync } from "zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compressJson } from "./http-compress";

let server: Server;
let port = 0;
const big = JSON.stringify({ items: "x".repeat(5000) });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    await compressJson(req, res);
    const type = req.url?.includes("text") ? "text/plain" : "application/json";
    res.setHeader("Content-Type", type);
    res.end(req.url?.includes("small") ? "{}" : big);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function get(path: string, encoding = "gzip") {
  return new Promise<{ encoding?: string; body: Buffer }>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        headers: { "accept-encoding": encoding },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            encoding: res.headers["content-encoding"] as string | undefined,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("compressJson", () => {
  it("gzips API JSON for a client that takes it", async () => {
    const res = await get("/api/sessions");
    expect(res.encoding).toBe("gzip");
    expect(gunzipSync(res.body).toString()).toBe(big);
    expect(res.body.length).toBeLessThan(big.length / 10);
  });

  it("leaves pages, non-JSON, small bodies and identity clients alone", async () => {
    expect((await get("/page")).encoding).toBeUndefined();
    expect((await get("/api/text")).encoding).toBeUndefined();
    expect((await get("/api/small")).encoding).toBeUndefined();
    expect((await get("/api/sessions", "identity")).encoding).toBeUndefined();
  });
});
