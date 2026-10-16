import { describe, expect, it } from "vitest";
import { BUS_BRIEF } from "./brief";

describe("BUS_BRIEF", () => {
  it("forbids stopping processes by pattern and names dev:stop", () => {
    expect(BUS_BRIEF).toMatch(
      /Never stop processes with pkill\/killall by pattern/
    );
    expect(BUS_BRIEF).toContain("npm run dev:stop");
  });
});
