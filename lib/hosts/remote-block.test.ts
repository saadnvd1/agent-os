import { describe, expect, it } from "vitest";
import { cleanRemoteBlock } from "./remote-api";

describe("cleanRemoteBlock", () => {
  it("keeps lines and tabs, drops control characters", () => {
    expect(cleanRemoteBlock("a\r\nb\tc\u001b[0m\u0000d  \n", 100)).toBe(
      "a\nb\tc [0m d"
    );
  });
  it("keeps the end within the cap", () => {
    const out = cleanRemoteBlock("0123456789", 5);
    expect(out).toBe("…6789");
    expect(out.length).toBe(5);
  });
});
