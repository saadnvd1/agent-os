import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, insertSessionRow, type Session } from "../db";
import { tempDir } from "../test-temp";
import { seedWorkspace } from "../orchestrator/testing";
import { savedModelSettings, setModelSettings } from "../models/config";
import { PROVIDER_PRESETS } from "../models/providers";
import { setComposerModel } from "../models/session-model";
import { roleComposerModels } from "./role-models";
import type { ChatModel } from "./events";

const row = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as Session;

function session(projectId: string, extra: Record<string, string | null>) {
  const id = `s-${Math.random()}`;
  insertSessionRow(db, {
    id,
    name: id,
    tmux_name: id,
    working_directory: "/tmp",
    project_id: projectId,
    view: "chat",
    ...extra,
  });
  return id;
}

const claudeOwn: ChatModel[] = [
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
];

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'models%'`).run();
  const file = path.join(tempDir("aos-pi-rm-"), "models.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      providers: {
        local: { baseUrl: "http://127.0.0.1:9/v1", models: [{ id: "qwen3" }] },
      },
    })
  );
  vi.stubEnv("AGENTOS_PI_MODELS_FILE", file);
  setModelSettings({
    providers: [
      {
        ...PROVIDER_PRESETS.find((p) => p.id === "deepseek")!,
        auth: { kind: "env", name: "DEEPSEEK_API_KEY" },
        enabled: true,
      },
    ],
  });
});

describe("an analyst's composer model list", () => {
  it("is the server's catalog, with what it can't move to greyed and why", () => {
    const { app } = seedWorkspace();
    const analyst = row(
      session(app.id, {
        agent_role: "analyst",
        agent_type: "claude",
        model: "claude-opus-5-5",
      })
    );
    const list = roleComposerModels(analyst, claudeOwn);
    const by = (v: string) => list.find((m) => m.value === v)!;
    expect(by("anthropic/claude-opus-5-5")).toMatchObject({
      label: "Opus 5.5",
    });
    expect(by("anthropic/claude-opus-5-5").disabled).toBeUndefined();
    expect(by("deepseek/deepseek-flash").disabled).toBeUndefined();
    expect(by("zai/glm-5.3").disabled).toMatch(/turned off/);
    // Pi is another agent: a running Claude analyst can't move onto it.
    expect(by("pi/local/qwen3").disabled).toMatch(/Pi/);
  });

  it("leaves every other session's own list alone", () => {
    const { app } = seedWorkspace();
    for (const agent_role of ["developer", null]) {
      const s = row(
        session(app.id, { agent_role, agent_type: "claude", model: "opus" })
      );
      expect(roleComposerModels(s, claudeOwn)).toBe(claudeOwn);
    }
  });
});

describe("picking a model in an analyst's composer", () => {
  it("moves only that session, and a bare alias goes back to Anthropic", async () => {
    const { app } = seedWorkspace();
    const coder = session(app.id, {
      agent_type: "claude",
      model: "claude-sonnet-5-5",
      agent_role: "developer",
    });
    const analyst = session(app.id, {
      agent_type: "claude",
      model: "claude-opus-5-5",
      agent_role: "analyst",
    });
    const coderBefore = row(coder);
    const rolesBefore = savedModelSettings().roles;

    await setComposerModel(analyst, "deepseek/deepseek-flash");
    expect(row(analyst)).toMatchObject({
      model: "deepseek-flash",
      model_provider: "deepseek",
    });
    // Asking the other provider's endpoint for "opus" never happens.
    await setComposerModel(analyst, "opus");
    expect(row(analyst)).toMatchObject({ model: "opus", model_provider: null });

    expect(row(coder)).toEqual(coderBefore);
    expect(savedModelSettings().roles).toEqual(rolesBefore);
  });

  it("refuses a Pi model for a Claude analyst", async () => {
    const { app } = seedWorkspace();
    const analyst = session(app.id, {
      agent_type: "claude",
      model: "claude-opus-5-5",
      agent_role: "analyst",
    });
    await expect(setComposerModel(analyst, "pi/local/qwen3")).rejects.toThrow(
      /Pi/
    );
    expect(row(analyst).model).toBe("claude-opus-5-5");
  });
});
