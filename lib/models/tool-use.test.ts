import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cachedToolUse,
  checkToolUse,
  clearToolUse,
  ollamaOrigin,
} from "./tool-use";

let server: http.Server;
let origin: string;
let answer: (res: http.ServerResponse) => void;
let calls = 0;

beforeAll(async () => {
  server = http.createServer((_q, res) => {
    calls++;
    answer(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  clearToolUse();
  calls = 0;
});

const caps = (list: unknown) => (res: http.ServerResponse) =>
  res.end(JSON.stringify({ capabilities: list }));

describe("checkToolUse", () => {
  it("reads Ollama's capabilities", async () => {
    answer = caps(["completion", "tools"]);
    expect(await checkToolUse(origin, "a")).toBe(true);
    answer = caps(["completion"]);
    expect(await checkToolUse(origin, "b")).toBe(false);
  });

  it("counts a model it can't judge as able", async () => {
    answer = (res) => {
      res.statusCode = 404;
      res.end("not found");
    };
    expect(await checkToolUse(origin, "a")).toBe(true);
    answer = (res) => res.end("{}");
    expect(await checkToolUse(origin, "b")).toBe(true);
    expect(await checkToolUse("http://127.0.0.1:9", "c")).toBe(true);
  });

  it("asks once, then answers from the cache", async () => {
    answer = caps(["completion"]);
    expect(await checkToolUse(origin, "a")).toBe(false);
    expect(await checkToolUse(origin, "a")).toBe(false);
    expect(cachedToolUse(origin, "a")).toBe(false);
    expect(calls).toBe(1);
  });

  it("answers able at first sight and probes in the background", async () => {
    answer = caps(["completion"]);
    expect(cachedToolUse(origin, "a")).toBe(true);
    await checkToolUse(origin, "a");
    expect(cachedToolUse(origin, "a")).toBe(false);
  });
});

describe("ollamaOrigin", () => {
  it("strips the API path from a base URL", () => {
    expect(ollamaOrigin("http://h:11434/v1/")).toBe("http://h:11434");
    expect(ollamaOrigin("http://h:11434")).toBe("http://h:11434");
  });
});
