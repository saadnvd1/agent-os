import { describe, expect, it } from "vitest";
import { parseVersion, probeAgent } from "./probe";

describe("parseVersion", () => {
  it("reads each CLI's way of printing its version", () => {
    expect(parseVersion("codex-cli 0.156.0\n")).toBe("0.156.0");
    expect(parseVersion("1.18.23")).toBe("1.18.23");
    expect(parseVersion("opencode v2.0.1")).toBe("2.0.1");
    expect(parseVersion("2026.01.09-231024f")).toBe("2026.01.09-231024f");
    expect(parseVersion("0.0.1774126892-geb7ca3 (released 2026-03-21)")).toBe(
      "0.0.1774126892-geb7ca3"
    );
    expect(parseVersion("no version here")).toBeUndefined();
  });
});

describe("probeAgent", () => {
  it("says a CLI that isn't anywhere isn't installed", async () => {
    expect(await probeAgent("aider", "no-such-agent-cli-xyz")).toEqual({
      installed: false,
      auth: "unknown",
      hint: "Install no-such-agent-cli-xyz",
    });
  });

  it("needs nothing for a plain terminal", async () => {
    expect(await probeAgent("shell", "")).toEqual({
      installed: true,
      auth: "ready",
    });
  });
});
