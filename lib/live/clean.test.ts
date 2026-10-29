import { describe, expect, it } from "vitest";
import { cleanBody, cleanName } from "./clean";

describe("cleanName", () => {
  it("keeps a plain name and squeezes spaces", () => {
    expect(cleanName("  Ahmed   K ")).toBe("Ahmed K");
  });

  it("strips bidi controls, zero-width marks and tags", () => {
    expect(cleanName("A‮hmed​")).toBe("Ahmed");
    expect(cleanName("Ah\u{E0041}med")).toBe("Ahmed");
    expect(cleanName("Ah med")).toBe("Ahmed");
  });

  it("refuses an empty, over-long, mixed-script or non-string name", () => {
    expect(cleanName("​​")).toBeNull();
    expect(cleanName("a".repeat(41))).toBeNull();
    expect(cleanName("Аhmed")).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(cleanName("---")).toBeNull();
  });
});

describe("cleanBody", () => {
  it("keeps newlines and tabs, drops other controls and invisible text", () => {
    expect(cleanBody("fix\u0000 this\n\tplease‮⁦")).toBe("fix this\n\tplease");
  });

  it("refuses empty or too long text rather than cutting it", () => {
    expect(cleanBody("  \n ")).toBeNull();
    expect(cleanBody("x".repeat(2001))).toBeNull();
    expect(cleanBody("x".repeat(2000))).toHaveLength(2000);
  });

  it("refuses lone surrogates", () => {
    expect(cleanBody("a\uD800b")).toBeNull();
  });
});
