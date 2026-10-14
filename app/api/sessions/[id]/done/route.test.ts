import { beforeEach, describe, expect, it, vi } from "vitest";

const doneSession = vi.hoisted(() => vi.fn());
const deadline = vi.hoisted(() => vi.fn());
vi.mock("@/lib/done", () => ({
  doneSession,
  getDoneTarget: (id: string) => {
    if (id === "gone") throw new Error("Session not found");
    return { id, name: "Fix pair page menu label" };
  },
}));
vi.mock("@/lib/done/deadline", () => ({
  withinDeadline: (...a: unknown[]) => {
    deadline(...a);
    return a[0];
  },
}));

const { POST } = await import("./route");
const post = (id: string) =>
  POST(new Request("http://x", { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

const unhandled: unknown[] = [];
process.on("unhandledRejection", (e) => unhandled.push(e));

beforeEach(() => {
  vi.clearAllMocks();
  unhandled.length = 0;
});

describe("POST /api/sessions/:id/done", () => {
  it("answers 404 for an unknown id, without starting anything or leaving a rejection", async () => {
    const res = await post("gone");
    expect(res.status).toBe(404);
    expect(doneSession).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 10));
    expect(unhandled).toEqual([]);
  });

  it("runs a quick change's done through the deadline wrapper", async () => {
    doneSession.mockResolvedValue({ text: "Merged." });
    const res = await post("q1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: { text: "Merged." } });
    expect(deadline).toHaveBeenCalledWith(
      expect.any(Promise),
      "Fix pair page menu label"
    );
  });

  it("returns the refusal, and a second done while one runs is refused", async () => {
    let finish!: (v: unknown) => void;
    doneSession.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const first = post("q2");
    await new Promise((r) => setTimeout(r, 0));
    const second = await post("q2");
    expect(second.status).toBe(409);
    expect((await second.json()).error).toMatch(/already being finished/);
    expect(doneSession).toHaveBeenCalledTimes(1);
    finish({ text: "ok" });
    expect((await first).status).toBe(200);

    doneSession.mockRejectedValueOnce(new Error("Not done. ci failed"));
    const refused = await post("q2");
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/ci failed/);
  });
});
