import { describe, expect, it } from "vitest";
import { AGENT_DEFAULT_MODEL } from "../../providers/registry";
import type { ChatStartOptions } from "../driver";
import { copilotArgs, copilotDefaultModel, copilotModels } from "./copilot";

const start = (model?: string) => ({ model }) as unknown as ChatStartOptions;

describe("copilotDefaultModel", () => {
  it("prefers COPILOT_MODEL over the settings file", () => {
    expect(
      copilotDefaultModel({ COPILOT_MODEL: "gpt-6" }, () => '{"model":"x"}')
    ).toBe("gpt-6");
  });

  it("reads the model from settings.json", () => {
    expect(copilotDefaultModel({}, () => '{"model":"claude-haiku-5.5"}')).toBe(
      "claude-haiku-5.5"
    );
  });

  it("is undefined with no file, bad JSON or no model", () => {
    const missing = () => {
      throw new Error("ENOENT");
    };
    expect(copilotDefaultModel({}, missing)).toBeUndefined();
    expect(copilotDefaultModel({}, () => "{")).toBeUndefined();
    expect(copilotDefaultModel({}, () => "{}")).toBeUndefined();
  });
});

describe("copilotArgs", () => {
  it("passes a chosen model", () => {
    expect(copilotArgs(start("gpt-6"), "haiku")).toEqual(["--model", "gpt-6"]);
  });

  it("falls back to the user's default for the agent default", () => {
    expect(copilotArgs(start(AGENT_DEFAULT_MODEL), "haiku")).toEqual([
      "--model",
      "haiku",
    ]);
    expect(copilotArgs(start(), "haiku")).toEqual(["--model", "haiku"]);
  });

  it("passes nothing with no model anywhere", () => {
    expect(copilotArgs(start(), undefined)).toEqual([]);
  });
});

describe("copilotModels", () => {
  it("maps availableModels with the usage multiplier", () => {
    expect(
      copilotModels({
        sessionId: "s",
        models: {
          currentModelId: "a",
          availableModels: [
            { modelId: "a", name: "Haiku", _meta: { copilotUsage: 0.33 } },
            {
              modelId: "b",
              name: "Luna",
              _meta: { copilotUsage: "15x usage" },
            },
            { modelId: "c", description: "Plain" },
            { name: "no id" },
          ],
        },
      })
    ).toEqual([
      { value: "a", label: "Haiku", description: "0.33x usage" },
      { value: "b", label: "Luna", description: "15x usage" },
      { value: "c", label: "c", description: "Plain" },
    ]);
  });

  it("is empty when the session lists no models", () => {
    expect(copilotModels({ sessionId: "s" })).toEqual([]);
    expect(copilotModels(undefined)).toEqual([]);
  });
});
