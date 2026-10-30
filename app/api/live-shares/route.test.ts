import { afterEach, describe, expect, it } from "vitest";
import { demoAllows } from "@/lib/security/demo";
import { POST } from "./route";
import { POST as act, DELETE } from "./[id]/route";

const req = (body: unknown, method = "POST") =>
  new Request("http://localhost/api/live-shares", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: "abc" }) };

describe("live-shares routes", () => {
  afterEach(() => {
    delete process.env.AGENTOS_DEMO;
  });

  it("are refused in demo mode, every one that changes state", async () => {
    process.env.AGENTOS_DEMO = "1";
    expect((await POST(req({ sessionId: "s" }))).status).toBe(403);
    expect(
      (await act(req({ action: "admit", guestId: "g" }), ctx)).status
    ).toBe(403);
    expect((await DELETE(req({}, "DELETE"), ctx)).status).toBe(403);
  });

  it("the demo gate lets none of them through", () => {
    const home = "/srv/demo/home";
    for (const [method, url] of [
      ["POST", "/api/live-shares"],
      ["GET", "/api/live-shares"],
      ["POST", "/api/live-shares/abc"],
      ["DELETE", "/api/live-shares/abc"],
    ])
      expect(demoAllows({ method, url }, home)).toBe(false);
  });

  it("reject a bad body or an unknown action", async () => {
    expect((await POST(req({ nope: 1 }))).status).toBe(400);
    expect((await act(req({ action: "run", text: "rm" }), ctx)).status).toBe(
      400
    );
  });

  it("accept watch and suggest only, and history as a boolean", async () => {
    expect((await POST(req({ sessionId: "s", level: "drive" }))).status).toBe(
      400
    );
    expect((await POST(req({ sessionId: "s", level: "root" }))).status).toBe(
      400
    );
    expect((await POST(req({ sessionId: "s", history: "yes" }))).status).toBe(
      400
    );
    expect(
      (await act(req({ action: "level", level: "drive" }), ctx)).status
    ).toBe(400);
  });
});
