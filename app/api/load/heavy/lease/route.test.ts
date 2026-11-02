import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { leaseCount, resetLeases } from "@/lib/load/heavy-lease";

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/load/heavy/lease", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

afterEach(resetLeases);

describe("POST /api/load/heavy/lease", () => {
  it("refuses a missing or bad pid", async () => {
    for (const body of [{}, { pid: 0 }, { pid: "x" }, { pid: 1, action: "no" }])
      expect((await post(body)).status).toBe(400);
    expect(leaseCount()).toBe(0);
  });

  it("grants any caller a slot, in a session or not, and takes it back", async () => {
    const res = await post({ pid: process.pid, session: null });
    expect(await res.json()).toEqual({ granted: true, ahead: 0 });
    expect(leaseCount()).toBe(1);
    await post({ pid: process.pid, action: "release" });
    expect(leaseCount()).toBe(0);
  });
});
