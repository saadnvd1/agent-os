import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { ownsWorktrees, sweepEnabled } from "./start";

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), "aos-sweep-own-"));

describe("who may sweep", () => {
  it("only a production server, or one asked to, and never under the test runner", () => {
    expect(sweepEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(sweepEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(
      sweepEnabled({ NODE_ENV: "development", AGENTOS_WORKTREE_SWEEP: "1" })
    ).toBe(true);
    expect(
      sweepEnabled({ NODE_ENV: "production", AGENTOS_WORKTREE_SWEEP: "0" })
    ).toBe(false);
    expect(sweepEnabled({ NODE_ENV: "production", VITEST: "true" })).toBe(
      false
    );
  });

  it("the first sweep claims the folder; another database can't take it", () => {
    const root = folder();
    expect(ownsWorktrees(false, root, "/a/one.db")).toBe(false);
    expect(ownsWorktrees(true, root, "/a/one.db")).toBe(true);
    expect(ownsWorktrees(false, root, "/a/one.db")).toBe(true);
    expect(ownsWorktrees(true, root, "/b/two.db")).toBe(false);
  });
});
