import { describe, expect, it } from "vitest";
import type { SessionStatus } from "@/components/views/types";
import {
  applyStreamMessage,
  HIDDEN_MS,
  reconnectOnReturn,
  SILENT_MS,
  silentTooLong,
} from "./stream";

const st = (status: string) => ({ status }) as unknown as SessionStatus;

describe("applyStreamMessage", () => {
  it("takes a snapshot whole and its place in the stream", () => {
    expect(
      applyStreamMessage(null, undefined, {
        type: "snapshot",
        epoch: "e",
        seq: 4,
        statuses: { a: st("idle") },
      })
    ).toEqual({
      position: { epoch: "e", seq: 4 },
      statuses: { a: st("idle") },
    });
  });

  it("applies the next delta: changed merged, removed dropped", () => {
    const next = applyStreamMessage(
      { epoch: "e", seq: 4 },
      { a: st("idle"), b: st("idle") },
      {
        type: "statuses",
        seq: 5,
        changed: { a: st("running") },
        removed: ["b"],
      }
    );
    expect(next).toEqual({
      position: { epoch: "e", seq: 5 },
      statuses: { a: st("running") },
    });
  });

  it("ignores pings and load, which aren't numbered", () => {
    expect(
      applyStreamMessage({ epoch: "e", seq: 1 }, {}, { type: "ping" })
    ).toBeNull();
  });

  it("asks for a resync on a gap or before any snapshot", () => {
    const delta = {
      type: "changed" as const,
      seq: 7,
      topics: ["stacks"],
    };
    expect(applyStreamMessage({ epoch: "e", seq: 5 }, {}, delta)).toBe(
      "resync"
    );
    expect(applyStreamMessage(null, {}, delta)).toBe("resync");
    expect(applyStreamMessage({ epoch: "e", seq: 6 }, {}, delta)).toEqual({
      position: { epoch: "e", seq: 7 },
    });
  });
});

describe("when the stream reconnects", () => {
  it("after the pings stop, not before", () => {
    expect(silentTooLong(true, 0, SILENT_MS)).toBe(false);
    expect(silentTooLong(true, 0, SILENT_MS + 1)).toBe(true);
    // A socket that isn't open is the reconnect timer's to handle.
    expect(silentTooLong(false, 0, SILENT_MS * 2)).toBe(false);
  });

  it("on return after being hidden a while, or with the socket closed", () => {
    const OPEN = 1;
    expect(reconnectOnReturn(OPEN, 1000, 1000 + HIDDEN_MS)).toBe(false);
    expect(reconnectOnReturn(OPEN, 1000, 1000 + HIDDEN_MS + 1)).toBe(true);
    expect(reconnectOnReturn(OPEN, 0, 10 ** 9)).toBe(false);
    expect(reconnectOnReturn(3, 0, 0)).toBe(true);
    expect(reconnectOnReturn(2, 0, 0)).toBe(true);
  });
});
