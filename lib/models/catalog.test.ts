import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { modelCatalog, piProviders, unconfiguredChoices } from "./catalog";
import { effectiveModels } from "./config";
import { PROVIDER_PRESETS } from "./providers";

const write = (content: unknown) => {
  const file = path.join(tempDir("aos-pi-cat-"), "models.json");
  fs.writeFileSync(
    file,
    typeof content === "string" ? content : JSON.stringify(content)
  );
  return file;
};

describe("piProviders", () => {
  it("reads Pi's providers and their models", () => {
    const file = write({
      providers: {
        local: {
          baseUrl: "http://localhost:8080/v1",
          models: [{ id: "qwen3-27b", name: "Qwen 27B" }, "plain"],
        },
        bad: { models: [] },
        cloud: { baseUrl: "https://api.example.com/v1", models: [{ id: "x" }] },
      },
    });
    expect(piProviders(file)).toEqual([
      {
        id: "local",
        baseUrl: "http://localhost:8080/v1",
        models: [{ id: "qwen3-27b", name: "Qwen 27B" }, { id: "plain" }],
      },
      {
        id: "cloud",
        baseUrl: "https://api.example.com/v1",
        models: [{ id: "x" }],
      },
    ]);
  });

  it("is empty for a missing or broken file", () => {
    expect(piProviders("/nonexistent/models.json")).toEqual([]);
    expect(piProviders(write("{not json"))).toEqual([]);
    expect(piProviders(write({ providers: 3 }))).toEqual([]);
  });
});

describe("modelCatalog", () => {
  it("lists Claude models and Pi's, labelled by where they run", () => {
    const pi = piProviders(
      write({
        providers: {
          local: {
            baseUrl: "http://127.0.0.1:1/v1",
            models: [{ id: "qwen3-27b", name: "Qwen 27B" }],
          },
          cloud: {
            baseUrl: "https://api.example.com/v1",
            models: [{ id: "big" }],
          },
        },
      })
    );
    const all = modelCatalog(effectiveModels({}), pi);
    const opus = all.find((c) => c.ref === "anthropic/claude-opus-5-5")!;
    expect(opus).toMatchObject({
      group: "Anthropic (Claude login)",
      agent: "claude",
      locality: "cloud",
      gateCapable: true,
      availability: { state: "up" },
    });
    expect(all.find((c) => c.ref === "pi/local/qwen3-27b")).toMatchObject({
      label: "Qwen 27B",
      group: "Pi · local",
      agent: "pi",
      locality: "local",
      gateCapable: false,
    });
    // A cloud endpoint isn't probed.
    expect(all.find((c) => c.ref === "pi/cloud/big")).toMatchObject({
      locality: "cloud",
      availability: { state: "unknown" },
    });
  });

  it("leaves out a provider that is turned off", () => {
    const all = modelCatalog(effectiveModels({}), []);
    expect(all.some((c) => c.ref.startsWith("deepseek/"))).toBe(false);
  });

  it("marks a model that can call tools, and an enabled provider with no key", () => {
    const all = modelCatalog(
      effectiveModels({
        providers: [
          {
            ...PROVIDER_PRESETS.find((p) => p.id === "deepseek")!,
            enabled: true,
          },
        ],
      }),
      []
    );
    expect(
      all.find((c) => c.ref === "anthropic/claude-opus-5-5")
    ).toMatchObject({ toolUse: true });
    const ds = all.find((c) => c.ref === "deepseek/deepseek-flash")!;
    expect(ds.toolUse).toBe(true);
    expect(ds.unusable).toMatch(/needs a base URL and a key/);
  });
});

describe("unconfiguredChoices", () => {
  it("lists the models of a provider that is turned off, with why", () => {
    const off = unconfiguredChoices(effectiveModels({}));
    expect(off.find((c) => c.ref === "deepseek/deepseek-flash")).toMatchObject({
      group: "DeepSeek",
      unusable: "The DeepSeek provider is turned off",
    });
    expect(off.some((c) => c.ref.startsWith("anthropic/"))).toBe(false);
  });
});
