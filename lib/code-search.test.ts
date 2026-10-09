import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { searchCode } from "./code-search";

const hasRg = (() => {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// CI installs ripgrep, so there a missing rg fails rather than skips.
describe.skipIf(!hasRg && !process.env.CI)("searchCode", () => {
  it("reads a query starting with - as a pattern, never an option", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-search-"));
    fs.writeFileSync(path.join(dir, "a.sh"), 'touch "$0.ran"\n--pre=sh\n');
    const matches = searchCode(dir, "--pre=sh");
    expect(fs.existsSync(path.join(dir, "a.sh.ran"))).toBe(false);
    expect(matches.length).toBeGreaterThan(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
