import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { seedWorkspace } from "./testing";
import { ensureOrchestrator } from "./home";
import { runTool } from "./serve";
import { orchestratorExtras } from "./worker";
import { addRule, listRules, MAX_RULES, removeRule } from "./rules";

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-rules-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

// What a new worker for the orchestrator would start with.
const prompt = async (workspaceId: string) =>
  (await orchestratorExtras(ensureOrchestrator(workspaceId))).systemAppend!;

describe("standing rules", () => {
  it("kept with rule_add, are in the prompt of every start after it", async () => {
    const { workspace } = seedWorkspace();
    const w = workspace.id;
    expect(await prompt(w)).toContain("- None. Keep one with rule_add.");

    const reply = await runTool(w, "rule_add", { text: "Never merge #111" });
    expect(reply).toMatch(/^Rule \d+ kept/);
    const [rule] = listRules(w);

    // A start, and another one after it: the rule comes from the database,
    // not from the conversation that wrote it.
    for (let start = 0; start < 2; start++) {
      const text = await prompt(w);
      expect(text).toContain(`- [rule ${rule.id}] Never merge #111`);
      expect(text).toContain("## Where things stand");
      expect(text).toMatch(/treat it as authoritative/);
    }
    // And the decision log shows it was kept.
    const notes = db
      .prepare(`SELECT text FROM orchestrator_notes WHERE workspace_id = ?`)
      .all(w) as { text: string }[];
    expect(notes.map((n) => n.text)).toContain(
      `Standing rule ${rule.id}: Never merge #111`
    );
  });

  it("removed with rule_remove, leave the prompt but stay on record", async () => {
    const { workspace } = seedWorkspace();
    const w = workspace.id;
    const rule = addRule(w, "Never merge #98", "saad");
    expect(await prompt(w)).toContain("Never merge #98 (Saad)");
    await runTool(w, "rule_remove", { id: rule.id });
    expect(await prompt(w)).not.toContain(`[rule ${rule.id}]`);
    const row = db
      .prepare(
        `SELECT removed_at, removed_by FROM orchestrator_rules WHERE id = ?`
      )
      .get(rule.id) as { removed_at: string | null; removed_by: string };
    expect(row.removed_at).not.toBeNull();
    expect(row.removed_by).toBe("orchestrator");
  });

  it("are the workspace's own: another workspace's rule can't be removed", async () => {
    const a = seedWorkspace().workspace.id;
    const b = seedWorkspace().workspace.id;
    const rule = addRule(
      a,
      "Saad's AgentOS URL is the one in Settings",
      "saad"
    );
    await expect(runTool(b, "rule_remove", { id: rule.id })).rejects.toThrow(
      /No rule/
    );
    expect(listRules(a)).toHaveLength(1);
    expect(listRules(b)).toHaveLength(0);
  });

  it("are kept once each, and capped", () => {
    const w = seedWorkspace().workspace.id;
    const first = addRule(w, "  One   rule ", "orchestrator");
    expect(addRule(w, "One rule", "saad").id).toBe(first.id);
    for (let i = 1; i < MAX_RULES; i++) addRule(w, `Rule ${i}`, "orchestrator");
    expect(() => addRule(w, "One too many", "saad")).toThrow(/remove one/);
    removeRule(w, first.id, "saad");
    expect(addRule(w, "Room again", "saad").text).toBe("Room again");
  });

  it("refuse an empty or overlong rule", async () => {
    const w = seedWorkspace().workspace.id;
    expect(() => addRule(w, "   ", "saad")).toThrow(/empty/);
    await expect(
      runTool(w, "rule_add", { text: "x".repeat(301) })
    ).rejects.toThrow(/Bad arguments/);
  });
});
