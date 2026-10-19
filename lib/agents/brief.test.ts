import { describe, expect, it } from "vitest";
import { BUS_BRIEF, WAIT_ADVICE } from "./brief";

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

  it("tells agents how to wait without a polling job", () => {
    expect(BUS_BRIEF).toContain(WAIT_ADVICE);
    expect(WAIT_ADVICE).toMatch(/run_in_background and end your turn/);
    expect(WAIT_ADVICE).toMatch(/sleep on each pass/);
  });
});
