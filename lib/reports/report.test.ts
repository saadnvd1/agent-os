import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildReport } from "./generate";
import { modeOf, setTaskMode, setWorkspaceMode } from "./mode";
import {
  claimDraft,
  getReport,
  insertReport,
  latestReport,
  reopenDraft,
} from "./store";
import { ev, HEAD } from "./fixtures";
import type { Gathered } from "./evidence/gather";

const S = { id: "rep-s", name: "Add thing", task_prompt: "Add the thing" };

beforeEach(() => {
  db.exec(`DELETE FROM health_reports; DELETE FROM operating_modes;`);
  db.exec(`DELETE FROM sessions WHERE id = 'rep-s'`);
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, workspace_id)
     VALUES ('rep-s', 'Add thing', 'rep-s', '/tmp', 'rep-w')`
  ).run();
});

const gathered = (over: Partial<Gathered> = {}): Gathered => ({
  state: "checks-failing",
  head: HEAD,
  evidence: [
    ev("state:task", "state", "fail", { label: "Task state: checks-failing" }),
    ev("ci:unit", "ci", "fail", { label: "CI · unit", sha: HEAD }),
  ],
  hash: "h1",
  items: [{ label: "The thing works" }],
  stages: {
    planned: true,
    pushed: true,
    prOpen: true,
    ciGreen: false,
    reviewed: false,
    merged: false,
  },
  analystDraft: null,
  ...over,
});

describe("operating mode", () => {
  it("is manual, then the workspace's, then the task's own; null follows the workspace again", () => {
    expect(modeOf("rep-s")).toEqual({ mode: "manual", source: "default" });
    setWorkspaceMode("rep-w", "assisted");
    expect(modeOf("rep-s")).toEqual({ mode: "assisted", source: "workspace" });
    setTaskMode("rep-s", "autonomous");
    expect(modeOf("rep-s")).toEqual({ mode: "autonomous", source: "task" });
    setTaskMode("rep-s", null);
    expect(modeOf("rep-s").source).toBe("workspace");
  });
});

describe("buildReport", () => {
  it("keeps the computed estimate and strips invented numbers from a model reply", () => {
    const raw = {
      headline: "65% done",
      lines: [
        {
          tone: "done",
          text: "Everything is 100% finished.",
          evidence: ["ci:unit"],
        },
        {
          tone: "warn",
          text: "The unit check is failing.",
          evidence: ["ci:unit"],
        },
      ],
      recommendation: null,
      acceptance: [{ item: 1, evidence: ["ci:unit"] }],
      nextPrompt: null,
    };
    const r = buildReport(S, gathered(), "on-demand", raw, null);
    expect(r.estimate).toMatchObject({
      basis: "acceptance",
      done: 0,
      total: 1,
    });
    expect(r.lines.map((l) => l.text)).toEqual(["The unit check is failing."]);
    expect(r.headline).not.toMatch(/%/);
    expect(r.dropped).toBe(2);
    expect(r.source).toBe("model");
  });

  it("falls back to template sentences when the model failed or every line was rejected", () => {
    const failed = buildReport(S, gathered(), "on-demand", null, null);
    expect(failed.source).toBe("template");
    expect(failed.lines.length).toBeGreaterThan(0);
    const rejected = buildReport(
      S,
      gathered(),
      "on-demand",
      { lines: [{ tone: "done", text: "Fine", evidence: [] }] },
      null
    );
    expect(rejected.source).toBe("template");
  });

  it("offers a next-prompt draft only outside Manual and before the task ends", () => {
    const raw = { lines: [], nextPrompt: "Fix the unit check." };
    expect(buildReport(S, gathered(), "cycle", raw, null).draft).toBeNull();
    setTaskMode("rep-s", "assisted");
    expect(buildReport(S, gathered(), "cycle", raw, null).draft?.text).toBe(
      "Fix the unit check."
    );
    expect(
      buildReport(S, gathered({ state: "merged" }), "end", raw, null).draft
    ).toBeNull();
  });
});

describe("report store and drafts", () => {
  const save = (draft?: string) =>
    insertReport(
      {
        ...buildReport(S, gathered(), "cycle", null, null),
        draft: draft
          ? { source: "report", id: "", text: draft, status: "pending" }
          : null,
      },
      "h1"
    );

  it("stores a report and reads it back, stale once the head moved", () => {
    const id = save();
    expect(getReport(id)?.headline).toMatch(/Checks are failing/);
    expect(latestReport("rep-s", HEAD)?.stale).toBe(false);
    expect(latestReport("rep-s", "other")?.stale).toBe(true);
  });

  it("claims a draft once, so a double tap sends once", () => {
    const id = save("Fix it");
    expect(claimDraft(id, "sent")).toBe(true);
    expect(claimDraft(id, "sent")).toBe(false);
    expect(claimDraft(id, "dismissed")).toBe(false);
    reopenDraft(id);
    expect(claimDraft(id, "dismissed")).toBe(true);
  });

  it("supersedes a pending draft when a newer report is saved", () => {
    const first = save("Old prompt");
    save("New prompt");
    expect(claimDraft(first, "sent")).toBe(false);
    expect(getReport(first)?.draft?.status).toBe("superseded");
  });
});
