import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { sendBounded } from "./ws-send";

const socket = (
  bufferedAmount: number,
  readyState: number = WebSocket.OPEN
) => ({
  readyState,
  bufferedAmount,
  send: vi.fn(),
  terminate: vi.fn(),
});

describe("sendBounded", () => {
  it("sends to an open socket that's keeping up, however big the message", () => {
    const ws = socket(0);
    expect(sendBounded(ws, "x".repeat(10_000_000), 1000)).toBe(true);
    expect(ws.send).toHaveBeenCalledOnce();
  });

  it("cuts off a socket with too much still unsent instead of queueing more", () => {
    const ws = socket(2000);
    expect(sendBounded(ws, "x", 1000)).toBe(false);
    expect(ws.terminate).toHaveBeenCalledOnce();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("drops messages for a closed socket", () => {
    const ws = socket(0, WebSocket.CLOSED);
    expect(sendBounded(ws, "x")).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
    expect(ws.terminate).not.toHaveBeenCalled();
  });
});
