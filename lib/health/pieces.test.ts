import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createProject } from "@/lib/projects";
import { seedSession } from "@/lib/orchestrator/testing";
import { closeResolvedPieces, reportDuplicatePiece } from "./pieces";
import { openAnomalies } from "./store";

const project = createProject({ name: "app", workingDirectory: "/tmp/app" });
const other = createProject({ name: "api", workingDirectory: "/tmp/api" });
const feature = {
  id: "f1",
  name: "Health watcher",
  workspace_id: "w1",
  plan_session_id: "plan-session",
  created_at: "2026-10-14 10:00:00",
};
const piece = (id = 1, project_id = project.id) => ({
  id,
  name: "Health panel",
  slice: "a settings tab listing open anomalies",
  project_id,
});

function merged(over: {
  name: string;
  prompt: string;
  projectId?: string;
  at?: string;
}) {
  const id = seedSession({
    projectId: over.projectId ?? project.id,
    name: over.name,
  });
  db.prepare(
    `UPDATE sessions SET task_status = 'merged', pr_number = 41, task_prompt = ?, updated_at = ? WHERE id = ?`
  ).run(over.prompt, over.at ?? "2026-10-14 12:00:00", id);
  return id;
}

beforeEach(() => {
  db.exec(`DELETE FROM health_anomalies`);
  db.prepare(`DELETE FROM sessions WHERE project_id IN (?, ?)`).run(
    project.id,
    other.id
  );
});

describe("piece-dup", () => {
  it("reports a piece that starts when matching work already merged in its project", () => {
    merged({
      name: "health-panel-tab",
      prompt: "Add a health panel tab to settings listing anomalies",
    });
    reportDuplicatePiece(feature, piece(), []);
    const [row] = openAnomalies();
    expect(row).toMatchObject({
      check_id: "piece-dup",
      subject: "piece:1",
      workspace_id: "w1",
    });
    expect(row.line).toContain("PR #41");
    expect(row.line).toContain("Health panel");
  });

  it("ignores unrelated merges, other projects and merges before the feature", () => {
    merged({ name: "fix-login", prompt: "Fix the login redirect loop" });
    merged({
      name: "health-panel-tab",
      prompt: "health panel settings anomalies",
      projectId: other.id,
    });
    merged({
      name: "health-panel-old",
      prompt: "health panel settings anomalies",
      at: "2026-10-13 12:00:00",
    });
    reportDuplicatePiece(feature, piece(), []);
    expect(openAnomalies()).toEqual([]);
  });

  it("doesn't count the feature's own tasks", () => {
    const own = merged({
      name: "health-panel-tab",
      prompt: "health panel settings anomalies",
    });
    reportDuplicatePiece(feature, piece(), [own]);
    expect(openAnomalies()).toEqual([]);
  });

  it("is one anomaly however many times the piece is looked at", () => {
    merged({
      name: "health-panel-tab",
      prompt: "health panel settings anomalies",
    });
    for (let i = 0; i < 3; i++) reportDuplicatePiece(feature, piece(), []);
    expect(openAnomalies()).toHaveLength(1);
  });

  it("closes when the piece is merged or dropped", () => {
    merged({
      name: "health-panel-tab",
      prompt: "health panel settings anomalies",
    });
    db.prepare(
      `INSERT INTO feature_pieces (id, feature_id, position, name, slice, project_id, status) VALUES (9001, 'f1', 1, 'Health panel', 's', ?, 'building')`
    ).run(project.id);
    reportDuplicatePiece(feature, piece(9001), []);
    expect(closeResolvedPieces(Date.now())).toBe(0);
    db.prepare(
      `UPDATE feature_pieces SET status = 'merged' WHERE id = 9001`
    ).run();
    expect(closeResolvedPieces(Date.now())).toBe(1);
    expect(openAnomalies()).toEqual([]);
    db.prepare(`DELETE FROM feature_pieces WHERE id = 9001`).run();
  });
});
