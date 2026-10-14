import { beforeEach, describe, expect, it } from "vitest";
import {
  PEER_POLL_MS,
  PEER_STALE_MS,
  parseReading,
  peerReading,
  peerSource,
  refreshPeers,
  setPeerReading,
} from "./peer-load";

const body = {
  level: "green",
  load1: 1.5,
  cores: 8,
  memUsedPct: 40,
  booted: 0,
  capabilities: ["linux"],
};

describe("parseReading", () => {
  it("accepts a well-formed answer", () => {
    expect(parseReading(body, 5)).toMatchObject({
      at: 5,
      level: "green",
      cores: 8,
      capabilities: ["linux"],
    });
  });

  it.each([
    ["not an object", "green"],
    ["no level yet (before its first sample)", { ...body, level: null }],
    ["an unknown level", { ...body, level: "purple" }],
    ["a negative load", { ...body, load1: -1 }],
    ["no cores", { ...body, cores: 0 }],
    ["a non-number load", { ...body, load1: "1" }],
  ])("rejects %s", (_n, input) => {
    expect(parseReading(input, 1)).toBeNull();
  });

  it("drops capability entries it doesn't trust", () => {
    const r = parseReading(
      { ...body, capabilities: ["mac", 3, "x".repeat(40)] },
      1
    );
    expect(r?.capabilities).toEqual(["mac"]);
  });
});

describe("the peer poll", () => {
  const id = "peer-load-test";
  beforeEach(() => setPeerReading(id, null));

  it("reads a machine, and not again within the poll time", async () => {
    let calls = 0;
    const fetcher = async () => (calls++, body);
    await refreshPeers([id], 1000, fetcher);
    await refreshPeers([id], 1000 + PEER_POLL_MS - 1, fetcher);
    expect(calls).toBe(1);
    await refreshPeers([id], 1000 + PEER_POLL_MS, fetcher);
    expect(calls).toBe(2);
    expect(peerSource(id, 1000 + PEER_POLL_MS)).toMatchObject({
      level: "green",
      stale: false,
    });
  });

  it("a machine that is no longer linked fails only its own fetch", async () => {
    await expect(
      refreshPeers([id, "no-such-host"], 1000, async (h) => {
        if (h === id) return body;
        throw new Error("not linked");
      })
    ).resolves.toBeUndefined();
    expect(peerReading(id)).not.toBeNull();
    await expect(refreshPeers(["no-such-host"], 1000)).resolves.toBeUndefined();
  });

  it("a reading older than 60 seconds is stale, and so is none", async () => {
    await refreshPeers([id], 0, async () => body);
    expect(peerSource(id, PEER_STALE_MS).stale).toBe(false);
    expect(peerSource(id, PEER_STALE_MS + 1).stale).toBe(true);
    expect(peerSource("never-read", 0).stale).toBe(true);
  });

  it("a failed poll keeps the old reading, which then ages out", async () => {
    await refreshPeers([id], 0, async () => body);
    await refreshPeers([id], PEER_POLL_MS, async () => {
      throw new Error("down");
    });
    expect(peerSource(id, PEER_POLL_MS).level).toBe("green");
    expect(peerSource(id, PEER_STALE_MS + 1).stale).toBe(true);
  });

  it("ignores an answer it can't parse", async () => {
    await refreshPeers([id], 0, async () => ({ level: "wat" }));
    expect(peerSource(id, 0).stale).toBe(true);
  });
});
