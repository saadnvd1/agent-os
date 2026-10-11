import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRepoCI, repoHasCI, type RepoCIDeps } from "./repo-ci";

let clock = 0;
const deps = (over: Partial<RepoCIDeps> = {}): RepoCIDeps => ({
  workflows: async () => [],
  history: async () => 0,
  now: () => clock,
  ...over,
});

beforeEach(() => {
  clock = 0;
  clearRepoCI();
});

describe("repoHasCI", () => {
  it("is yes on a workflow file, without asking GitHub", async () => {
    const history = vi.fn(async () => 0);
    const d = deps({
      workflows: async () => [".github/workflows/ci.yml"],
      history,
    });
    expect(await repoHasCI("/r", "origin/main", d)).toBe("yes");
    expect(history).not.toHaveBeenCalled();
  });

  it("is no when there are no workflows and nothing ever ran", async () => {
    expect(await repoHasCI("/r", "origin/main", deps())).toBe("no");
  });

  it("is yes when a check ran on the default branch or recent PRs", async () => {
    expect(
      await repoHasCI("/r", "origin/main", deps({ history: async () => 3 }))
    ).toBe("yes");
  });

  it("is unknown, not no, when GitHub can't say", async () => {
    const boom = deps({
      history: async () => {
        throw new Error("rate limited");
      },
    });
    expect(await repoHasCI("/r", "origin/main", boom)).toBe("unknown");
    expect(
      await repoHasCI("/r", "origin/main", deps({ history: async () => null }))
    ).toBe("unknown");
  });

  it("is unknown when the base can't be read and GitHub can't say", async () => {
    const d = deps({
      workflows: async () => {
        throw new Error("bad ref");
      },
      history: async () => null,
    });
    expect(await repoHasCI("/r", "origin/nope", d)).toBe("unknown");
  });

  it("remembers no for 10 minutes and unknown not at all", async () => {
    const history = vi.fn(async () => 0 as number | null);
    const d = deps({ history });
    await repoHasCI("/r", "origin/main", d);
    await repoHasCI("/r", "origin/main", d);
    expect(history).toHaveBeenCalledTimes(1);
    clock = 11 * 60 * 1000;
    await repoHasCI("/r", "origin/main", d);
    expect(history).toHaveBeenCalledTimes(2);

    clearRepoCI();
    history.mockResolvedValue(null);
    await repoHasCI("/r", "origin/main", d);
    await repoHasCI("/r", "origin/main", d);
    expect(history).toHaveBeenCalledTimes(4);
  });
});
