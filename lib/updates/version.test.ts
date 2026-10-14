import { describe, expect, it } from "vitest";
import { compareVersions, isNewer, parseVersion, versionFor } from "./version";

describe("versions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("0.3.551", "0.3.560")).toBe(-1);
    expect(compareVersions("0.10.0", "0.9.99")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("treats a missing segment as 0 and ignores a leading v", () => {
    expect(compareVersions("v1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBe(1);
  });

  it("refuses what isn't a version", () => {
    for (const bad of ["", "abc", "1.2.0-beta", "1..2", "1.2.x"])
      expect(parseVersion(bad)).toBeNull();
    expect(compareVersions("abc", "1.0.0")).toBeNull();
    expect(isNewer("abc", "1.0.0")).toBe(false);
  });

  it("isNewer is strict", () => {
    expect(isNewer("0.3.2", "0.3.1")).toBe(true);
    expect(isNewer("0.3.1", "0.3.1")).toBe(false);
    expect(isNewer("0.3.0", "0.3.1")).toBe(false);
  });

  it("builds a version from package.json and the commit count", () => {
    expect(versionFor("0.3.1", 551)).toBe("0.3.551");
    expect(versionFor("1.4", 7)).toBe("1.4.7");
    expect(versionFor("nope", 7)).toBeNull();
  });
});
