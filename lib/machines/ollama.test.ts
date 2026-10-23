import { describe, expect, it, vi } from "vitest";
import { ollamaBase, ollamaModels } from "./ollama";

const answer = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body }) as Response);

describe("ollamaModels", () => {
  it("lists the tags Ollama serves", async () => {
    const f = answer({ models: [{ name: "qwen3:27b" }, { name: "llama3" }] });
    expect(await ollamaModels(f, "http://x:1")).toEqual([
      "qwen3:27b",
      "llama3",
    ]);
    expect(f).toHaveBeenCalledWith("http://x:1/api/tags", expect.anything());
  });

  it("is empty when it isn't running, errors or sends junk", async () => {
    expect(
      await ollamaModels(vi.fn().mockRejectedValue(new Error("refused")))
    ).toEqual([]);
    expect(await ollamaModels(answer({}, false))).toEqual([]);
    expect(await ollamaModels(answer({ models: [{ name: 3 }, {}] }))).toEqual(
      []
    );
  });

  it("reads OLLAMA_HOST, with or without a scheme", () => {
    expect(ollamaBase({})).toBe("http://127.0.0.1:11434");
    expect(ollamaBase({ OLLAMA_HOST: "gpu:11434/" })).toBe("http://gpu:11434");
    expect(ollamaBase({ OLLAMA_HOST: "https://o.example" })).toBe(
      "https://o.example"
    );
  });
});
