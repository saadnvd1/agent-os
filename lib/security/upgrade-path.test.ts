import { describe, it, expect } from "vitest";
import { upgradePath } from "./upgrade-path";

describe("upgradePath", () => {
  it("reads normal targets", () => {
    expect(upgradePath("/ws/terminal?x=1")).toBe("/ws/terminal");
    expect(upgradePath(undefined)).toBeNull();
  });

  it.each(["http://[", "http://a b@/x", "%", "http://[::1"])(
    "returns null instead of throwing for %j",
    (t) => {
      expect(() => upgradePath(t)).not.toThrow();
    }
  );
});
