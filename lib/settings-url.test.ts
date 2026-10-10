import { describe, expect, it } from "vitest";
import {
  SETTINGS_SECTIONS,
  hrefWithSettings,
  settingsFromHref,
} from "./settings-url";
import {
  hrefWithSession,
  safeNextPath,
  sessionIdFromHref,
} from "./session-url";

describe("settingsFromHref", () => {
  it("reads each section", () => {
    for (const section of SETTINGS_SECTIONS)
      expect(settingsFromHref(`/?settings=${section}`)).toEqual({
        open: true,
        section,
      });
  });

  it("opens at the top for a bare or unknown section, and stays shut without one", () => {
    expect(settingsFromHref("/?settings")).toEqual({
      open: true,
      section: null,
    });
    expect(settingsFromHref("/?settings=../../etc")).toEqual({
      open: true,
      section: null,
    });
    expect(settingsFromHref("/?session=abc")).toEqual({
      open: false,
      section: null,
    });
  });
});

describe("hrefWithSettings", () => {
  it("sets, moves and removes the section, keeping the session", () => {
    const opened = hrefWithSettings("/?session=abc#x", {
      open: true,
      section: "merging",
    });
    expect(opened).toBe("/?session=abc&settings=merging#x");
    expect(sessionIdFromHref(opened)).toBe("abc");
    expect(hrefWithSettings(opened, { open: true, section: "devices" })).toBe(
      "/?session=abc&settings=devices#x"
    );
    expect(hrefWithSettings(opened, { open: false, section: null })).toBe(
      "/?session=abc#x"
    );
  });

  it("writes the list as a bare ?settings that reads back the same", () => {
    const href = hrefWithSettings("/", { open: true, section: null });
    expect(href).toBe("/?settings");
    expect(settingsFromHref(href)).toEqual({ open: true, section: null });
  });

  it("survives a session switch and the way back from pairing", () => {
    const href = hrefWithSession("/?settings=schedules", "s1");
    expect(settingsFromHref(href).section).toBe("schedules");
    expect(safeNextPath("/?settings=schedules")).toBe("/?settings=schedules");
  });
});
