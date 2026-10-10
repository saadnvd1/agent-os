import { describe, expect, it, vi } from "vitest";
import { relayedSetup, toRelayedSetup } from "./peer-setup";

const link = {
  hostId: "box",
  hostName: "box",
  url: "http://box:3011",
  token: "t",
};

describe("a linked machine's setup", () => {
  it("keeps only the expected shape, marked relayed", () => {
    const setup = toRelayedSetup({
      status: "running",
      stages: [
        { id: "deps", label: "Install dependencies", state: "running" },
        { id: "x", label: "Bad", state: "exploded" },
        null,
      ],
      log: ["$ npm ci", 7, "\u001b[31mred\u001b[0m"],
      branch: "feature/x",
      error: null,
      startedAt: 5,
      extra: "dropped",
    });
    expect(setup).toEqual({
      status: "running",
      stages: [{ id: "deps", label: "Install dependencies", state: "running" }],
      log: ["$ npm ci", "[31mred [0m"],
      branch: "feature/x",
      error: null,
      startedAt: 5,
      relayed: true,
    });
  });

  it("is nothing for an answer that isn't a setup", () => {
    expect(toRelayedSetup(null)).toBeNull();
    expect(toRelayedSetup({ status: "weird" })).toBeNull();
  });

  it("is nothing when that machine can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(relayedSetup(link, "s1")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });
});
