import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKTREES_DIR, worktreesRoot } from "./worktrees";
import { refuseRealStateUnderTest } from "./test-home-guard";
import { orchestratorDir } from "./orchestrator/home";

const realHome = os.userInfo().homedir;

afterEach(() => vi.unstubAllEnvs());

describe("worktrees root under the test runner", () => {
  it("throws when it would resolve inside the real ~/.agent-os", () => {
    expect(() => worktreesRoot(realHome)).toThrow(/Refusing/);
  });

  it("resolves under the given home otherwise", () => {
    const tmp = path.join(os.tmpdir(), "somewhere");
    expect(worktreesRoot(tmp)).toBe(path.join(tmp, ".agent-os", "worktrees"));
  });

  it("tests run with a temp home, so the real constants are safe", () => {
    expect(WORKTREES_DIR.startsWith(realHome + path.sep)).toBe(false);
    expect(process.env.HOME?.startsWith(os.tmpdir())).toBe(true);
    expect(orchestratorDir("w").startsWith(process.env.HOME!)).toBe(true);
  });

  it("leaves look-alike folders alone", () => {
    const p = path.join(realHome, ".agent-os-other", "x");
    expect(refuseRealStateUnderTest(p)).toBe(p);
  });

  it("does nothing outside the test runner", () => {
    vi.stubEnv("VITEST", "");
    const p = path.join(realHome, ".agent-os", "worktrees");
    expect(refuseRealStateUnderTest(p)).toBe(p);
  });
});
