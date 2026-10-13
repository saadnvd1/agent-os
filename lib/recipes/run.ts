// Starting a run: claim the one live slot, compose the prompt, start a fresh
// task or session through the same gates and brakes as any other start.

import { randomUUID } from "crypto";
import { db } from "../db";
import { getProject } from "../projects";
import { isRemoteHost } from "../hosts";
import { createTask } from "../tasks";
import { startOrQueue } from "../tasks/queue";
import { launchSession } from "../sessions/launch";
import { braked, BrakeRefused } from "../orchestrator/brakes";
import { getOrchestrator } from "../orchestrator/home";
import { composePrompt } from "./compose";
import {
  getRecipe,
  getRun,
  lastRevisionId,
  liveRun,
  modelOf,
  toRun,
} from "./store";
import type { Recipe, RecipeRun, RunTriggerKind } from "./types";

export class AlreadyRunning extends Error {
  constructor(readonly run: RecipeRun) {
    super(`"${run.recipe_id}" already has run #${run.seq} going`);
  }
}

export interface StartRunOptions {
  trigger: RunTriggerKind;
  // The agent session that asked (the orchestrator, or one using aos).
  actorSessionId?: string | null;
  note?: string | null;
  // A manual run's client key: a repeat gets the same run.
  requestId?: string | null;
  scheduleRunId?: number | null;
}

export interface Started {
  run: RecipeRun;
  queued: boolean;
}

const BRAKED: RunTriggerKind[] = ["tool", "cli", "timer", "catch-up"];

function claim(
  recipe: Recipe,
  o: StartRunOptions,
  sessionId: string
): RecipeRun {
  if (o.requestId) {
    const again = db
      .prepare(`SELECT * FROM recipe_runs WHERE request_id = ?`)
      .get(o.requestId) as Parameters<typeof toRun>[0] | undefined;
    if (again) return toRun(again);
  }
  try {
    return db.transaction(() => {
      const seq = (
        db
          .prepare(
            `SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM recipe_runs WHERE recipe_id = ?`
          )
          .get(recipe.id) as { n: number }
      ).n;
      const prompt = composePrompt(recipe, {
        seq,
        trigger: o.trigger,
        note: o.note,
      });
      const id = Number(
        db
          .prepare(
            `INSERT INTO recipe_runs (recipe_id, seq, trigger, triggered_by_session_id, schedule_run_id, request_id,
               note, prompt, revision_id, status, session_id, started_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'starting', ?, datetime('now'))`
          )
          .run(
            recipe.id,
            seq,
            o.trigger,
            o.actorSessionId ?? null,
            o.scheduleRunId ?? null,
            o.requestId ?? null,
            o.note?.trim() || null,
            prompt,
            lastRevisionId(recipe.id),
            sessionId
          ).lastInsertRowid
      );
      return getRun(id)!;
    })();
  } catch (error) {
    if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      const live = liveRun(recipe.id);
      if (live) throw new AlreadyRunning(live);
    }
    throw error;
  }
}

function settleStart(
  runId: number,
  status: "running" | "queued" | "failed" | "skipped",
  fields: { sessionId?: string; error?: string } = {}
) {
  db.prepare(
    `UPDATE recipe_runs SET status = ?, session_id = COALESCE(?, session_id), error = ?,
       ended_at = CASE WHEN ? IN ('failed','skipped') THEN datetime('now') ELSE ended_at END
     WHERE id = ? AND status IN ('starting','queued')`
  ).run(status, fields.sessionId ?? null, fields.error ?? null, status, runId);
}

export async function startRun(
  recipeId: string,
  o: StartRunOptions
): Promise<Started> {
  const recipe = getRecipe(recipeId);
  if (!recipe || recipe.archived_at) throw new Error("Recipe not found");
  const project = getProject(recipe.project_id);
  if (!project) throw new Error("Its project no longer exists");
  if (isRemoteHost(project.host_id))
    throw new Error(`${project.name} runs on another machine`);
  const ws = recipe.workspace_id;
  const sessionId = randomUUID();
  const run = claim(recipe, o, sessionId);
  // A repeat of a request that already started.
  if (run.session_id !== sessionId)
    return Promise.resolve({ run, queued: false });
  const byOrchestrator = o.trigger === "tool";
  const startedBy = byOrchestrator ? (getOrchestrator(ws)?.id ?? null) : null;
  const name = `${recipe.name} #${run.seq}`;
  const model = modelOf(recipe);
  const gated = <T>(kind: "task" | "session", start: () => Promise<T>) =>
    BRAKED.includes(o.trigger)
      ? braked(ws, kind, start, (r) => (r as { id?: string }).id ?? null, {
          spendApproval: o.trigger === "tool" || o.trigger === "cli",
        })
      : start();

  const go = async (): Promise<Started> => {
    if (recipe.kind === "session") {
      const { session } = await gated("session", () =>
        launchSession({
          id: sessionId,
          projectId: recipe.project_id,
          agentType: "claude",
          prompt: run.prompt,
          name,
          view: recipe.view,
          access: "full",
          model: typeof model === "string" ? model : null,
          startedBy,
        }).then((l) => ({ ...l, id: l.session.id }))
      );
      settleStart(run.id, "running", { sessionId: session.id });
      return { run: getRun(run.id)!, queued: false };
    }
    const out = await startOrQueue(
      {
        projectId: recipe.project_id,
        prompt: run.prompt,
        name,
        view: recipe.view,
        model: model ?? undefined,
        plan: false,
        planReason: "recipe run",
        startedBy,
        originWorkspaceId: byOrchestrator ? ws : undefined,
      },
      () =>
        gated("task", () =>
          createTask({
            id: sessionId,
            projectId: recipe.project_id,
            prompt: run.prompt,
            name,
            view: recipe.view,
            model: model ?? undefined,
            plan: false,
            planReason: "recipe run",
            startedBy,
          })
        )
    );
    if ("queued" in out) {
      settleStart(run.id, "queued", { sessionId: out.queued.id });
      return { run: getRun(run.id)!, queued: true };
    }
    settleStart(run.id, "running", { sessionId: out.started.id });
    return { run: getRun(run.id)!, queued: false };
  };

  return go().catch((error) => {
    const brake = error instanceof BrakeRefused;
    settleStart(run.id, brake ? "skipped" : "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  });
}
