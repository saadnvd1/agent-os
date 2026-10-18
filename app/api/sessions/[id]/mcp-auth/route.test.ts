import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  start: vi.fn(),
  finish: vi.fn(),
  reconnect: vi.fn(),
}));
vi.mock("@/lib/chat/mcp-auth", () => ({
  startMcpSignIn: auth.start,
  finishMcpSignIn: auth.finish,
  reconnectMcpServer: auth.reconnect,
}));

const { POST } = await import("./route");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://x/api/sessions/s1/mcp-auth", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "s1" }) }
  );
const base = { server: "linear", itemId: "mcp-1" };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/sessions/[id]/mcp-auth", () => {
  it("starts with the browser's own origin, never one from the body", async () => {
    auth.start.mockResolvedValue({ mode: "callback", authUrl: "https://a/b" });
    const res = await post(
      { ...base, action: "start", origin: "https://evil.example" },
      { origin: "https://mac.ts.net:3443" }
    );
    expect(await res.json()).toEqual({
      mode: "callback",
      authUrl: "https://a/b",
    });
    expect(auth.start).toHaveBeenCalledWith("s1", {
      ...base,
      origin: "https://mac.ts.net:3443",
    });
  });

  it("finishes with a pasted address pinned to the row", async () => {
    auth.finish.mockResolvedValue({ server: "linear" });
    const res = await post({
      ...base,
      action: "submit",
      url: " https://x/cb?code=1&state=2 ",
    });
    expect(res.status).toBe(200);
    expect(auth.finish).toHaveBeenCalledWith("https://x/cb?code=1&state=2", {
      sessionId: "s1",
      server: "linear",
    });
  });

  it("reconnects", async () => {
    auth.reconnect.mockResolvedValue(undefined);
    expect((await post({ ...base, action: "reconnect" })).status).toBe(200);
    expect(auth.reconnect).toHaveBeenCalledWith("s1", base);
  });

  it("refuses a bad body without calling anything", async () => {
    for (const body of [
      null,
      { action: "start" },
      { ...base, action: "nope" },
      { ...base, action: "submit" },
      { ...base, server: "x".repeat(300), action: "start" },
    ])
      expect((await post(body)).status).toBe(400);
    expect(auth.start).not.toHaveBeenCalled();
    expect(auth.finish).not.toHaveBeenCalled();
  });

  it("answers a refusal with its reason", async () => {
    auth.start.mockRejectedValue(new Error("This chat's agent isn't running."));
    const res = await post({ ...base, action: "start" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/isn't running/);
  });
});
