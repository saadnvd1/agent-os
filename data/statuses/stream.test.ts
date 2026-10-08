import { describe, expect, it } from "vitest";
import type { SessionStatus } from "@/components/views/types";
import { applyStreamMessage } from "./stream";

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
