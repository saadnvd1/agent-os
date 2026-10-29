import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveSocket, cableUrl, type WsLike } from "./socket";
import type { ConnectFiles } from "@/lib/connect/config";
import crypto from "crypto";

const keys = crypto.generateKeyPairSync("ed25519");
const files: ConnectFiles = {
  config: {
    machineId: "abcd1234",
    hostname: "",
    apiUrl: "https://example.test",
  },
  machineKey: keys.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
};

interface Fake extends WsLike {
  out: Record<string, unknown>[];
  fire: (e: string, d?: unknown) => void;
}
let fakes: Fake[] = [];
const factory = () => {
  const handlers: Record<string, (d?: unknown) => void> = {};
  const f = {
    readyState: 1,
    out: [] as Record<string, unknown>[],
    send: (d: string) => f.out.push(JSON.parse(d)),
    close: () => {},
    terminate: () => {
      f.readyState = 3;
    },
    on: (e: string, fn: (d?: unknown) => void) => {
      handlers[e] = fn;
    },
    fire: (e: string, d?: unknown) => handlers[e]?.(d),
  } as unknown as Fake;
  fakes.push(f);
  return f;
};
const ident = JSON.stringify({ channel: "LiveHostChannel", share_id: "s1" });
const hear = (f: Fake, m: unknown) => f.fire("message", JSON.stringify(m));

beforeEach(() => {
  vi.useFakeTimers();
  fakes = [];
});
afterEach(() => vi.useRealTimers());

function open(onFrame = vi.fn()) {
  const sock = new LiveSocket({
    files: () => files,
    onFrame,
    factory,
    random: () => 0.5,
  });
  sock.subscribe("s1");
  const f = fakes[0];
  hear(f, { type: "welcome" });
  hear(f, { type: "confirm_subscription", identifier: ident });
  return { sock, f, onFrame };
}

describe("LiveSocket", () => {
  it("turns https into wss", () => {
    expect(cableUrl("https://runagentos.com")).toBe(
      "wss://runagentos.com/cable"
    );
  });

  it("opens only while a share is subscribed", () => {
    const sock = new LiveSocket({
      files: () => files,
      onFrame: vi.fn(),
      factory,
    });
    expect(fakes).toHaveLength(0);
    sock.subscribe("s1");
    expect(fakes).toHaveLength(1);
    sock.unsubscribe("s1");
    expect(fakes[0].readyState).toBe(3);
  });

  it("hands frames only for subscribed shares", () => {
    const { f, onFrame } = open();
    hear(f, { identifier: ident, message: { type: "presence" } });
    hear(f, {
      identifier: JSON.stringify({
        channel: "LiveHostChannel",
        share_id: "other",
      }),
      message: { type: "presence" },
    });
    hear(f, {
      identifier: JSON.stringify({ channel: "Other", share_id: "s1" }),
      message: { type: "presence" },
    });
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("holds actions until the subscription is confirmed", () => {
    const sock = new LiveSocket({
      files: () => files,
      onFrame: vi.fn(),
      factory,
    });
    sock.subscribe("s1");
    const f = fakes[0];
    hear(f, { type: "welcome" });
    sock.send("s1", "state", { state: "idle" });
    expect(f.out.filter((m) => m.command === "message")).toHaveLength(0);
    hear(f, { type: "confirm_subscription", identifier: ident });
    expect(f.out.filter((m) => m.command === "message")).toHaveLength(1);
  });

  it("paces sends under Connect's per-second limit", () => {
    const { sock, f } = open();
    for (let i = 0; i < 30; i++) sock.send("s1", "item", { id: `i${i}` });
    const sent = () => f.out.filter((m) => m.command === "message").length;
    expect(sent()).toBe(10);
    vi.advanceTimersByTime(1500);
    expect(sent()).toBeGreaterThan(10);
    vi.advanceTimersByTime(10_000);
    expect(sent()).toBe(30);
  });

  it("never sends a frame over 60 KB", () => {
    const { sock, f } = open();
    sock.send("s1", "item", { text: "x".repeat(70_000) });
    expect(f.out.filter((m) => m.command === "message")).toHaveLength(0);
    expect(sock.dropped).toBe(1);
  });

  it("reconnects with backoff and resubscribes", () => {
    const { f } = open();
    f.fire("close");
    expect(fakes).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(fakes).toHaveLength(2);
    hear(fakes[1], { type: "welcome" });
    expect(fakes[1].out.some((m) => m.command === "subscribe")).toBe(true);
  });

  it("drops a rejected subscription and tells the caller", () => {
    const onRejected = vi.fn();
    const sock = new LiveSocket({
      files: () => files,
      onFrame: vi.fn(),
      onRejected,
      factory,
    });
    sock.subscribe("s1");
    hear(fakes[0], { type: "welcome" });
    hear(fakes[0], { type: "reject_subscription", identifier: ident });
    expect(onRejected).toHaveBeenCalledWith("s1");
    expect(sock.has("s1")).toBe(false);
  });
});
