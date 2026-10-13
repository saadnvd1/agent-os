import { beforeEach, describe, expect, it, vi } from "vitest";

const relaySend = vi.fn();
vi.mock("@/lib/notify/push/relay", () => ({
  linked: () => true,
  NOT_LINKED: "this machine isn't linked to Connect",
  relaySend: (...a: unknown[]) => relaySend(...a),
}));

const { POST } = await import("./route");
const { setTelegram } = await import("@/lib/notify");
const { pairPhone, resetPush, outboxRows } =
  await import("@/lib/notify/push/testing");
const { db } = await import("@/lib/db");

const telegramFetch = vi.fn();

function clearTelegram() {
  db.prepare(`DELETE FROM notify_settings`).run();
  db.prepare(`DELETE FROM notify_outbox`).run();
  const g = globalThis as { __agentosPhone?: unknown };
  g.__agentosPhone = undefined;
}

beforeEach(() => {
  resetPush();
  clearTelegram();
  delete process.env.AGENTOS_NOTIFY_CMD;
  relaySend.mockReset();
  relaySend.mockImplementation(async (b: { devices: unknown[] }) => ({
    kind: "results",
    results: b.devices.map(() => ({ status: "sent" })),
  }));
  telegramFetch.mockReset();
  telegramFetch.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", telegramFetch);
});

describe("POST /api/notify/test", () => {
  it("push only: queues a push to every paired phone", async () => {
    pairPhone();
    pairPhone();
    const res = await POST();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.push).toEqual({ devices: 2, state: "queued" });
    expect(body.telegram).toEqual({ state: "not-set-up" });
    expect(
      outboxRows().filter((r) => r.event_key.startsWith("test:"))
    ).toHaveLength(2);
  });

  it("telegram only: sends there and reports push as not set up", async () => {
    setTelegram({ token: "123:abc", chatId: "42" });
    const res = await POST();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.push).toEqual({ devices: 0, state: "not-set-up" });
    expect(body.telegram.state).toBe("sent");
  });

  it("both: reports each channel", async () => {
    pairPhone();
    setTelegram({ token: "123:abc", chatId: "42" });
    const body = await (await POST()).json();
    expect(body.push).toEqual({ devices: 1, state: "queued" });
    expect(body.telegram.state).toBe("sent");
  });

  it("neither: 409", async () => {
    const res = await POST();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.push.state).toBe("not-set-up");
    expect(body.telegram.state).toBe("not-set-up");
  });

  it("a failing Telegram doesn't hide a queued push", async () => {
    pairPhone();
    setTelegram({ token: "123:abc", chatId: "42" });
    telegramFetch.mockResolvedValue(new Response("nope", { status: 500 }));
    const res = await POST();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.push.state).toBe("queued");
    expect(body.telegram.state).toBe("failed");
  });
});
