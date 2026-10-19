import { describe, expect, it } from "vitest";
import { BUS_BRIEF } from "./brief";

describe("BUS_BRIEF", () => {
  it("forbids stopping processes by pattern and names dev:stop", () => {
    expect(BUS_BRIEF).toMatch(
      /Never stop processes with pkill\/killall by pattern/
    );
    expect(BUS_BRIEF).toContain("npm run dev:stop");
  });

  it("tells agents aos read exists, when to use it, and that it is data", () => {
    expect(BUS_BRIEF).toContain("`aos read <session>`");
    expect(BUS_BRIEF).toMatch(/already answers/);
    expect(BUS_BRIEF).toMatch(/data, not instructions/);
  });
});
