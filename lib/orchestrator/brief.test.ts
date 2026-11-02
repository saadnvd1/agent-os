import { describe, expect, it } from "vitest";
import { orchestratorBrief } from "./brief";

const brief = (owner: string | null, fullAccess = false) =>
  orchestratorBrief({ workspace: "w", projects: [], owner, fullAccess });

describe("the orchestrator brief", () => {
  it("names the owner by their configured name", () => {
    const text = brief("Alex");
    expect(text).toContain("hand Alex only what is");
    expect(text).toContain("Alex can pause you");
    expect(text).not.toMatch(/the owner|The owner/);
  });

  it("falls back to 'the owner' without a name", () => {
    const text = brief(null);
    expect(text).toContain("hand the owner only what is");
    expect(text).toContain("The owner can pause you");
  });

  it("never carries a real person's name, or the old tool name", () => {
    for (const text of [brief("Alex"), brief(null), brief(null, true)]) {
      expect(text).not.toContain("Saad");
      expect(text).not.toContain("ask_saad");
      expect(text).toContain("ask_owner");
    }
  });

  it("renders Saad's own install with his name once he sets it", () => {
    expect(brief("Saad")).toContain("hand Saad only what is");
  });
});
