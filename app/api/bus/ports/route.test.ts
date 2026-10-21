import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const ensure = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ports/ensurePorts", () => ({ ensurePorts: ensure }));

const { POST } = await import("./route");

const call = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/bus/ports", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

describe("POST /api/bus/ports (aos port)", () => {
  it("refuses a body without a session or with a target that's neither a name nor a port", async () => {
    expect((await call({})).status).toBe(400);
    expect((await call({ from: "s", target: "3000; rm -rf /" })).status).toBe(
      400
    );
    expect(ensure).not.toHaveBeenCalled();
  });

  it("hands the session and target to ensurePorts and returns its report", async () => {
    ensure.mockResolvedValueOnce({
      text: "PORT=3101 is free.",
      blocked: false,
    });
    const res = await call({ from: "s1", target: "PORT" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: "PORT=3101 is free." });
    expect(ensure).toHaveBeenCalledWith("s1", "PORT");
  });

  it("is 404 for an unknown session and 409 for anything else it refuses", async () => {
    ensure.mockRejectedValueOnce(new Error("No session nope"));
    expect((await call({ from: "nope" })).status).toBe(404);
    ensure.mockRejectedValueOnce(new Error("No port named X"));
    expect((await call({ from: "s1", target: "X" })).status).toBe(409);
  });
});
