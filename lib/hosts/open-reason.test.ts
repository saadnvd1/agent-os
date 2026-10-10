import { describe, expect, it } from "vitest";
import { openBlockedReason } from "./open-reason";

describe("openBlockedReason", () => {
  it("says why a row can't open instead of doing nothing", () => {
    expect(
      openBlockedReason(
        { name: "main", hostId: "box" },
        { box: "timed out" },
        "box"
      )
    ).toBe("Can't reach box: timed out");
    expect(openBlockedReason({ name: "a b", hostId: "local" })).toContain(
      "tmux name"
    );
  });

  it("lets an openable row open", () => {
    expect(openBlockedReason({ name: "main", hostId: "local" })).toBeNull();
    // A linked machine's chat has no tmux name to check.
    expect(
      openBlockedReason({
        name: "x y",
        hostId: "box",
        peer: {
          id: "1",
          name: "c",
          view: "chat",
          agentType: "claude",
          state: null,
        },
      })
    ).toBeNull();
  });
});
