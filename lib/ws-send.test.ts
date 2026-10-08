import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { BACKLOG_MS, sendBounded } from "./ws-send";

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

  it("keeps sending through one big message still going out", () => {
    // ws counts a message being compressed at its full size: the send right
    // after a long chat's snapshot sees it all as unsent.
    const ws = socket(7_000_000);
    expect(sendBounded(ws, "x", 1000, 0)).toBe(true);
    expect(sendBounded(ws, "y", 1000, 5_000)).toBe(true);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it("cuts off a socket that stays far behind instead of queueing more", () => {
    const ws = socket(2000);
    expect(sendBounded(ws, "x", 1000, 0)).toBe(true);
    expect(sendBounded(ws, "y", 1000, BACKLOG_MS + 1)).toBe(false);
    expect(ws.terminate).toHaveBeenCalledOnce();
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  it("forgets a backlog that cleared", () => {
    const ws = socket(2000);
    sendBounded(ws, "x", 1000, 0);
    ws.bufferedAmount = 0;
    sendBounded(ws, "y", 1000, 10_000);
    ws.bufferedAmount = 2000;
    expect(sendBounded(ws, "z", 1000, BACKLOG_MS + 1)).toBe(true);
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it("drops messages for a closed socket", () => {
    const ws = socket(0, WebSocket.CLOSED);
    expect(sendBounded(ws, "x")).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
    expect(ws.terminate).not.toHaveBeenCalled();
  });
});
