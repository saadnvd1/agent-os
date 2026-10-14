import { randomUUID } from "crypto";
import { db } from "../../db";
import { saveItem } from "../../chat/store";
import { makeSession, workspaceWithProject } from "../../recipes/test-fixtures";
import type { Step } from "../types";

// A finished session in a fresh workspace, its steps written as chat items.
export function seedSession(
  o: {
    prompt?: string;
    steps?: Step[];
    final?: string;
    orchestrator?: boolean;
    fields?: Record<string, string | number | null>;
  } = {}
) {
  const { ws, project } = workspaceWithProject();
  const id = makeSession({
    project_id: project.id,
    task_prompt: o.prompt ?? "Send the latest build to the beta testers",
    name: "Beta build",
    ...o.fields,
  });
  let n = 0;
  const at = () => ({ id: `i${n++}`, createdAt: Date.now() + n });
  for (const s of o.steps ?? [])
    saveItem(
      id,
      s.kind === "user"
        ? { ...at(), kind: "user", text: s.text }
        : {
            ...at(),
            kind: "tool",
            name: s.name,
            title: s.name,
            input: s.command ? { command: s.command } : { file_path: s.path },
            status: s.failed ? "error" : "done",
            output: s.output,
          }
    );
  if (o.final) saveItem(id, { ...at(), kind: "assistant", text: o.final });
  if (o.orchestrator)
    makeSession({ role: "orchestrator", workspace_id: ws.id });
  return { id, ws, project };
}

export const clearCards = () =>
  db.exec(
    `DELETE FROM learning_cards; DELETE FROM experiment_usage; DELETE FROM orchestrator_notes`
  );

export const uid = () => randomUUID();
