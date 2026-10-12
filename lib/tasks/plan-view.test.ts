import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { db, type Session } from "../db";
import { saveItem } from "../chat/store";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import { PLAN_TEXT_MAX } from "./loop-types";
import { planTitle, taskPlan } from "./plan-view";

const make = (set: string, ...args: unknown[]) => {
  const { app } = seedWorkspace();
  const id = seedSession({
    projectId: app.id,
    name: "p",
    view: "chat",
    task: true,
  });
  if (set)
    db.prepare(`UPDATE sessions SET ${set} WHERE id = ?`).run(...args, id);
  return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session;
};
const worktree = (plan?: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-plan-"));
  if (plan !== undefined) {
    fs.mkdirSync(path.join(dir, ".agentos"));
    fs.writeFileSync(path.join(dir, ".agentos/plan.md"), plan);
  }
  return dir;
};

describe("taskPlan", () => {
  it("is null when nothing says there is or isn't a plan", () => {
    expect(taskPlan(make(""))).toBeNull();
  });

  it("keeps today's decision with no document", () => {
    expect(
      taskPlan(make("plan_decided = 0, plan_reason = 'tiny'"))
    ).toMatchObject({
      planned: false,
      reason: "tiny",
      status: null,
      text: null,
    });
  });

  it("is writing while the plan step runs", () => {
    const dir = worktree();
    const plan = taskPlan(
      make("plan_phase = 'planning', worktree_path = ?", dir)
    );
    expect(plan).toMatchObject({
      status: "writing",
      source: "step",
      planned: true,
    });
  });

  it("is approved once the step moved on, with title, path and capped text", () => {
    const dir = worktree("# Add the widget\n" + "line\n".repeat(2000));
    const plan = taskPlan(
      make(
        "plan_phase = 'implementing', plan_decided = 1, worktree_path = ?",
        dir
      )
    )!;
    expect(plan).toMatchObject({
      status: "approved",
      source: "step",
      title: "Add the widget",
      path: ".agentos/plan.md",
      truncated: true,
    });
    expect(plan.text!.length).toBe(PLAN_TEXT_MAX);
  });

  it("is ready for a chat's plan until it is carried out", () => {
    const s = make("chat_plan = 1");
    saveItem(s.id, {
      id: "plan-1",
      kind: "plan",
      plan: "## Do it\n- step",
      createdAt: Date.now(),
    } as never);
    expect(taskPlan(s)).toMatchObject({
      status: "ready",
      source: "chat",
      title: "Do it",
      path: null,
    });
    saveItem(s.id, {
      id: "plan-1",
      kind: "plan",
      plan: "## Do it\n- step",
      carried: true,
      createdAt: Date.now(),
    } as never);
    expect(taskPlan(s)).toMatchObject({ status: "approved", source: "chat" });
  });

  it("titles from the first heading, else the first line", () => {
    expect(planTitle("intro\n# Real title\n")).toBe("Real title");
    expect(planTitle("- first thing\n- second")).toBe("first thing");
    expect(planTitle("")).toBeNull();
  });
});
