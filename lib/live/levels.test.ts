import { describe, expect, it } from "vitest";
import { guestActions, levelOptions } from "./levels";
import { LEVELS } from "./types";

describe("level options", () => {
  it("come from LEVELS, with Drive off and a reason", () => {
    const o = levelOptions();
    expect(o.map((x) => x.value)).toEqual(["watch", "suggest", "drive"]);
    expect(o[0]).toMatchObject({ label: LEVELS.watch.label, enabled: true });
    expect(o[2]).toMatchObject({ enabled: false, reason: "Coming soon" });
  });

  it("gives a waiting guest Admit and Deny, an admitted one Kick", () => {
    const g = { id: "g", name: "A", online: true, at: 0 };
    expect(
      guestActions({} as never, { ...g, status: "pending" }).map((a) => a.kind)
    ).toEqual(["admit", "deny"]);
    expect(
      guestActions({} as never, { ...g, status: "admitted" }).map((a) => a.kind)
    ).toEqual(["kick"]);
  });
});
