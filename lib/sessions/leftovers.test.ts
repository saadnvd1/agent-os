import { describe, expect, it, vi } from "vitest";
import { releaseSessionLeftovers, sessionTmpDir } from "./leftovers";

describe("releasing a session's leftovers", () => {
  it("stops its dev server, drops its database and removes its temp folder", async () => {
    const stopDev = vi.fn(async () => {});
    const dropDatabase = vi.fn(async () => {});
    const removeDir = vi.fn(async () => {});
    await releaseSessionLeftovers(
      { id: "abc12345-6789", worktree_path: "/w/t" },
      { stopDev, dropDatabase, removeDir }
    );
    expect(stopDev).toHaveBeenCalledWith("/w/t");
    expect(dropDatabase).toHaveBeenCalledWith("abc12345-6789");
    expect(removeDir).toHaveBeenCalledWith(sessionTmpDir("abc12345-6789"));
  });

  it("does the other steps when one fails, and never throws", async () => {
    const dropDatabase = vi.fn(async () => {});
    const removeDir = vi.fn(async () => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      releaseSessionLeftovers(
        { id: "x", worktree_path: "/w/t" },
        {
          stopDev: async () => {
            throw new Error("nope");
          },
          dropDatabase,
          removeDir,
        }
      )
    ).resolves.toBeUndefined();
    expect(dropDatabase).toHaveBeenCalled();
    expect(removeDir).toHaveBeenCalled();
  });

  it("has no dev server to stop without a worktree", async () => {
    const stopDev = vi.fn(async () => {});
    await releaseSessionLeftovers(
      { id: "x" },
      { stopDev, dropDatabase: async () => {}, removeDir: async () => {} }
    );
    expect(stopDev).not.toHaveBeenCalled();
  });
});
