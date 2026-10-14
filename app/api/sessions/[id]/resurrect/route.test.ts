import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const resurrect = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resurrect", () => ({ resurrectSession: resurrect }));

const { POST } = await import("./route");

const call = (id: string) =>
  POST(
    new NextRequest(`http://localhost/api/sessions/${id}/resurrect`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id }) }
  );

describe("POST /api/sessions/:id/resurrect", () => {
  it("answers with the outcome", async () => {
    resurrect.mockResolvedValueOnce({ id: "s1", text: "back" });
    const res = await call("s1");
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toEqual({ id: "s1", text: "back" });
    expect(resurrect).toHaveBeenCalledWith("s1", { device: null });
  });

  it("answers a refusal with 409 and the reason", async () => {
    resurrect.mockRejectedValueOnce(new Error("its PR #3 was merged"));
    const res = await call("s2");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "its PR #3 was merged" });
  });
});
