import { describe, expect, it } from "vitest";
import { checkBusyIndicators } from "./status-detector";

const pane = (working: string) =>
  [
    "⏺ Write(lib/db/stacks.ts)",
    "  ⎿  Wrote 146 lines to lib/db/stacks.ts",
    "",
    working,
    "──────────────────────────────────────────",
    "❯ ",
    "──────────────────────────────────────────",
    "  agent-os-build (feature/build) ✗ 8 19m ago …",
    "  ⏵⏵ bypass permissions on · 1 monitor · ← for agents",
  ].join("\n");

describe("checkBusyIndicators", () => {
  it("sees Claude Code working above its input box, whatever the word", () => {
    expect(
      checkBusyIndicators(pane("✻ Composing… (4m 0s · ↓ 23.5k tokens)"))
    ).toBe(true);
    expect(checkBusyIndicators(pane("✢ Moseying… (12s · thinking)"))).toBe(
      true
    );
  });

  it("doesn't call a finished turn working", () => {
    expect(checkBusyIndicators(pane("⏺ Done. The PR is up."))).toBe(false);
  });
});
