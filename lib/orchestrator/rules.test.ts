import os from "os";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { seedWorkspace } from "./testing";
import { ensureOrchestrator } from "./home";
import { runTool } from "./serve";
import { orchestratorExtras } from "./worker";
import { addRule, listRules, MAX_RULES, removeRule, updateRule } from "./rules";
import { tempDir } from "@/lib/test-temp";

beforeAll(() => {
  const home = tempDir("aos-orch-rules-");
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
      expect(text).toContain(
        `- [rule ${rule.id}, kept by you] <untrusted source="a rule you kept">Never merge #111</untrusted>`
      );
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

  it("removed, leave the prompt but stay on record; the owner's only by the owner", async () => {
    const { workspace } = seedWorkspace();
    const w = workspace.id;
    const rule = addRule(w, "Never merge #98", "saad");
    expect(await prompt(w)).toContain(
      `[rule ${rule.id}, from the owner] Never merge #98`
    );
    // the owner's rule is his to lift: the orchestrator can't, whatever it read.
    await expect(runTool(w, "rule_remove", { id: rule.id })).rejects.toThrow(
      /only he removes it/
    );
    expect(await prompt(w)).toContain(`[rule ${rule.id}, from the owner]`);
    removeRule(w, rule.id, "saad");
    expect(await prompt(w)).not.toContain(`[rule ${rule.id},`);
    const row = db
      .prepare(
        `SELECT removed_at, removed_by FROM orchestrator_rules WHERE id = ?`
      )
      .get(rule.id) as { removed_at: string | null; removed_by: string };
    expect(row.removed_at).not.toBeNull();
    expect(row.removed_by).toBe("saad");
    // Its own, it may remove.
    const mine = addRule(w, "Hold #5 until CI is fixed", "orchestrator");
    await runTool(w, "rule_remove", { id: mine.id });
    expect(listRules(w)).toHaveLength(0);
  });

  it("are the workspace's own: another workspace's rule can't be removed", async () => {
    const a = seedWorkspace().workspace.id;
    const b = seedWorkspace().workspace.id;
    const rule = addRule(
      a,
      "The owner's AgentOS URL is the one in Settings",
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
    // the owner writing the same rule makes it his, so only he removes it.
    const his = addRule(w, "One rule", "saad");
    expect(his.id).toBe(first.id);
    expect(his.added_by).toBe("saad");
    expect(() => removeRule(w, first.id, "orchestrator")).toThrow(
      /the owner's/
    );
    expect(addRule(w, "One rule", "orchestrator").added_by).toBe("saad");
    for (let i = 1; i < MAX_RULES; i++) addRule(w, `Rule ${i}`, "orchestrator");
    expect(() => addRule(w, "One too many", "saad")).toThrow(/remove one/);
    removeRule(w, first.id, "saad");
    expect(addRule(w, "Room again", "saad").text).toBe("Room again");
  });

  it("reworded by the owner, show the new text; only in their own workspace, and not once removed", async () => {
    const a = seedWorkspace().workspace.id;
    const b = seedWorkspace().workspace.id;
    const rule = addRule(a, "Never merge #1", "saad");
    expect(updateRule(a, rule.id, "Never merge #2").text).toBe(
      "Never merge #2"
    );
    expect(await prompt(a)).toContain("Never merge #2");
    expect(() => updateRule(b, rule.id, "hijacked")).toThrow(/No rule/);
    expect(listRules(a)[0].text).toBe("Never merge #2");
    removeRule(a, rule.id, "saad");
    expect(() => updateRule(a, rule.id, "back")).toThrow(/No rule/);
  });

  it("are stored with anything token-shaped redacted", () => {
    const w = seedWorkspace().workspace.id;
    // Built here so nothing token-shaped is committed.
    const fake = ["gh", "p_", "0".repeat(36)].join("");
    const rule = addRule(w, `Deploy key is ${fake}`, "orchestrator");
    expect(rule.text).toBe("Deploy key is [redacted]");
  });

  it("refuse an empty or overlong rule", async () => {
    const w = seedWorkspace().workspace.id;
    expect(() => addRule(w, "   ", "saad")).toThrow(/empty/);
    await expect(
      runTool(w, "rule_add", { text: "x".repeat(301) })
    ).rejects.toThrow(/Bad arguments/);
  });
});
