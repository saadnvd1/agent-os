// Shared setup for the recipes tests: a workspace and project, a recipe in
// them, and a session standing in for a run's.

import { randomUUID } from "crypto";
import { db, updateSessionRow } from "../db";
import { createProject } from "../projects";
import { createWorkspace, setProjectWorkspace } from "../workspaces";
import { createRecipe } from "./store";
import type { Recipe, RecipeInput } from "./types";

export function workspaceWithProject() {
  const ws = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp",
  });
  setProjectWorkspace(project.id, ws.id);
  return { ws, project };
}

export function makeRecipe(
  fields: Partial<RecipeInput> = {},
  by: string | null = null
): Recipe {
  const { ws, project } = workspaceWithProject();
  return createRecipe(
    {
      workspaceId: ws.id,
      projectId: project.id,
      name: "TestFlight build",
      kind: "session",
      brief: "Run scripts/testflight and judge the result.",
      ...fields,
    },
    by
  );
}

export function makeSession(
  fields: Record<string, string | number | null> = {}
) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, view) VALUES (?, 's', ?, '/tmp', 'chat')`
  ).run(id, `claude-${id}`);
  updateSessionRow(db, id, fields);
  return id;
}
