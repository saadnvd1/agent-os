import { describe, expect, it } from "vitest";
import { hrefWithWelcome, welcomeFromHref } from "./welcome-url";

describe("welcome address", () => {
  it("reads the step, and starts at the first for a bare or unknown one", () => {
    expect(welcomeFromHref("http://h/?welcome=project")).toEqual({
      open: true,
      step: "project",
    });
    expect(welcomeFromHref("http://h/?welcome")).toEqual({
      open: true,
      step: "agents",
    });
    expect(welcomeFromHref("http://h/?welcome=nope").step).toBe("agents");
    expect(welcomeFromHref("http://h/").open).toBe(false);
  });

  it("sets and removes the step beside other parameters", () => {
    const open = hrefWithWelcome("http://h/?session=a#x", {
      open: true,
      step: "finish",
    });
    expect(open).toBe("/?session=a&welcome=finish#x");
    expect(
      hrefWithWelcome("http://h" + open, { open: false, step: "finish" })
    ).toBe("/?session=a#x");
  });

  it("keeps a session's readable path", () => {
    const open = hrefWithWelcome("http://h/s/fix-it-920654a6", {
      open: true,
      step: "agents",
    });
    expect(open).toBe("/s/fix-it-920654a6?welcome=agents");
    expect(
      hrefWithWelcome("http://h" + open, { open: false, step: "agents" })
    ).toBe("/s/fix-it-920654a6");
  });
});
