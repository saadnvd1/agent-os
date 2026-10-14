import { describe, expect, it } from "vitest";
import { fileName, formatBytes, redactionSummary } from "./format";

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
  });
  it("sizes", () => {
    expect(formatBytes(500)).toBe("500 bytes");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});
