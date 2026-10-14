import { describe, expect, it } from "vitest";
import {
  fileName,
  formatBytes,
  nothingLeft,
  redactionSummary,
  toggleDrop,
} from "./view";

describe("share format", () => {
  it("summarises what was masked, singular and plural", () => {
    const none = { secret: 0, path: 0, ip: 0, host: 0, email: 0 };
    expect(redactionSummary(none)).toBe("");
    expect(redactionSummary({ ...none, secret: 1, path: 12 })).toBe(
      "Masked: 1 secret, 12 paths"
    );
  });
  it("names the download after the title", () => {
    expect(fileName("My chat: part 2!")).toBe("my-chat-part-2.html");
    expect(fileName("???")).toBe("shared.html");
    expect(fileName("My chat: part 2!", "md")).toBe("my-chat-part-2.md");
  });
  it("sizes", () => {
    expect(formatBytes(500)).toBe("500 bytes");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
  it("toggles a drop without mutating", () => {
    const d = ["a"];
    expect(toggleDrop(d, "b")).toEqual(["a", "b"]);
    expect(toggleDrop(d, "a")).toEqual([]);
    expect(d).toEqual(["a"]);
  });
  it("counts only listed items as left out", () => {
    const items = [
      { id: "a", type: "user", tools: false, excerpt: "" },
      { id: "b", type: "assistant", tools: false, excerpt: "" },
    ];
    expect(nothingLeft(items, ["a"])).toBe(false);
    expect(nothingLeft(items, ["a", "b"])).toBe(true);
    // "t" is a hidden tool row: it must not make one remaining item look gone
    expect(nothingLeft(items, ["a", "t"])).toBe(false);
  });
});
