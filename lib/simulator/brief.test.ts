import { describe, expect, it } from "vitest";
import { simulatorBrief } from "./brief";
import { runningBrief } from "../project-config/brief";

const sim = { start: "npm run sim" };

describe("simulatorBrief", () => {
  it("says nothing when the project declares no simulator", () => {
    expect(simulatorBrief(undefined, true)).toBe("");
    expect(runningBrief({}, {})).toBe("");
  });

  it("explains the commands, that it is optional, and where shots go", () => {
    const text = simulatorBrief(sim, true);
    for (const needle of [
      "aos sim open",
      "aos sim snapshot -i",
      "aos sim screenshot --region @e3",
      "read the `read:` one",
      "full-size",
      "only the final changed screens",
      "never gates",
      "don't put them in commits",
    ])
      expect(text).toContain(needle);
  });

  it("says the tools are unavailable where there is no simulator", () => {
    const text = simulatorBrief(sim, false);
    expect(text).toContain("not available on this machine");
    expect(text).not.toContain("aos sim open");
  });

  it("is part of the running brief when declared", () => {
    expect(runningBrief({ simulator: sim }, {})).toContain(
      "## Running this project"
    );
  });
});
