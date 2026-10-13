import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// Simulator checks never gate a PR, a review or a build: nothing that decides
// a merge may read simulator state.
describe("simulator checks are optional", () => {
  it("no merge, review or gate module imports the simulator", () => {
    const gated = [
      "lib/tasks/merge-policy.ts",
      "lib/tasks/finish.ts",
      "lib/orchestrator/gate.ts",
      "lib/orchestrator/review.ts",
    ];
    const root = path.join(__dirname, "..", "..");
    for (const f of gated) {
      const file = path.join(root, f);
      if (!fs.existsSync(file)) continue;
      expect(fs.readFileSync(file, "utf8"), f).not.toMatch(/simulator/i);
    }
    const dir = path.join(root, "lib/orchestrator");
    for (const f of fs
      .readdirSync(dir)
      .filter(
        (n) =>
          /gate|merge/.test(n) && n.endsWith(".ts") && !n.endsWith(".test.ts")
      ))
      expect(fs.readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(
        /simulator/i
      );
  });
});
