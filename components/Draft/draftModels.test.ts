import { describe, expect, it } from "vitest";
import { draftModels } from "./draftModels";

const qwen = { value: "ollama/qwen3", label: "Qwen 3" };

describe("draftModels", () => {
  it("lists the default and then what OpenCode reports", () => {
    const list = draftModels("opencode", {
      data: [qwen],
      isPending: false,
      isError: false,
    });
    expect(list.map((m) => m.value)).toEqual(["default", "ollama/qwen3"]);
  });

  it("says so beside the default while loading and on failure", () => {
    const loading = draftModels("opencode", {
      isPending: true,
      isError: false,
    });
    const failed = draftModels("opencode", { isPending: false, isError: true });
    expect(loading).toHaveLength(1);
    expect(loading[0].label).toContain("loading");
    expect(failed[0].label).toContain("couldn't");
  });

  it("keeps a fixed list as it is", () => {
    const list = draftModels("claude", { isPending: true, isError: false });
    expect(list.map((m) => m.value)).toContain("opus");
  });
});
