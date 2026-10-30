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

  it("validate the access code shape (400) and accept the code actions", async () => {
    expect(
      (await POST(req({ sessionId: "s", code: { custom: 5 } }))).status
    ).toBe(400);
    expect((await POST(req({ sessionId: "s", code: {} }))).status).toBe(409);
    expect((await POST(req({ sessionId: "s", code: null }))).status).toBe(409);
    // A bad own code on a share this machine holds nothing of: 404, so it validated.
    expect((await act(req({ action: "code", code: "ab" }), ctx)).status).toBe(
      404
    );
    expect((await act(req({ action: "code", code: 5 }), ctx)).status).toBe(400);
    expect((await act(req({ action: "new_code" }), ctx)).status).toBe(404);
  });

  it("accept watch, suggest and drive, and history as a boolean", async () => {
    // Past validation: not linked to Connect here, so 409, never 400.
    expect((await POST(req({ sessionId: "s", level: "drive" }))).status).toBe(
      409
    );
    expect((await POST(req({ sessionId: "s", level: "root" }))).status).toBe(
      400
    );
    expect((await POST(req({ sessionId: "s", history: "yes" }))).status).toBe(
      400
    );
    // A level for a share this machine doesn't hold: 404, so it validated.
    expect(
      (await act(req({ action: "level", level: "drive" }), ctx)).status
    ).toBe(404);
    expect(
      (await act(req({ action: "level", level: "admin" }), ctx)).status
    ).toBe(400);
  });

  it("validate the wheel and admit-to-drive actions", async () => {
    for (const body of [
      { action: "wheel" },
      { action: "wheel", guestId: 7 },
      { action: "wheel", guestId: "" },
      { action: "admit", guestId: "g", drive: "yes" },
    ])
      expect((await act(req(body), ctx)).status).toBe(400);
    for (const body of [
      { action: "wheel", guestId: "g1" },
      { action: "wheel", guestId: null },
      { action: "admit", guestId: "g", drive: true },
    ])
      expect((await act(req(body), ctx)).status).toBe(404);
  });
});
