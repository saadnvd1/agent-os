import { describe, expect, it } from "vitest";
import { NAME_MAX, UNNAMED, cleanMachineName } from "./name";

describe("cleanMachineName", () => {
  it("keeps an ordinary name", () => {
    expect(cleanMachineName("Saturn mini")).toBe("Saturn mini");
    expect(cleanMachineName("box-12")).toBe("box-12");
  });

  it("masks anything that reads as a pairing code", () => {
    for (const raw of [
      "type 482913",
      "type 482 913",
      "type 48-29-13",
      "type ４８２９１３", // full width
      "type ٤٨٢٩١٣", // Arabic-Indic
      "type 4829",
      "Type 482, 913",
      "Type 482 - 913",
      "Type 482 and 913",
      "4 then 8 then 2 then 9",
    ])
      expect(cleanMachineName(raw)).not.toMatch(/\p{Nd}{2}.?\p{Nd}{2}/u);
    expect(cleanMachineName("type 482 913")).toBe("type ### ###");
    expect(cleanMachineName("Type 482 and 913")).toBe("Type ### and ###");
    for (const raw of ["Type 482 and 913", "Type 482, 913", "a1b2c3d4"])
      expect(cleanMachineName(raw)).not.toMatch(/\p{Nd}/u);
  });

  it("strips controls and direction overrides, and stays on one line", () => {
    expect(cleanMachineName("ab‮cd⁦e​f\nline\u0007")).toBe("abcdef line");
  });

  it("caps the length and never comes back empty", () => {
    expect([...cleanMachineName("x".repeat(500))]).toHaveLength(NAME_MAX);
    expect(cleanMachineName("‮​ ")).toBe(UNNAMED);
    expect(cleanMachineName(42)).toBe(UNNAMED);
  });
});
