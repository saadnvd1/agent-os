// The end-of-session hook: scripts first (free); a helper-model call only
// on a hit, through the experiments meter, never on the transcript.

import os from "os";
import { runClaude, type ClaudeRunner } from "../orchestrator/claude-cli";
import { getOrchestrator } from "../orchestrator/home";
import { queueEventOnce } from "../orchestrator/events";
import { untrusted, UNTRUSTED_RULE } from "../orchestrator/untrusted";
import { isRemoteHost } from "../hosts";
import { getProject } from "../projects";
import { getRecipe } from "../recipes/store";
import { draftRequest, parseDraft, recipePrefill } from "../recipes/draft";
import { countEvent, experimentRun, hasEvent } from "../experiments/meter";
import { experimentOn } from "../experiments";
import type { EndHow } from "../experiments/hooks";
import { readSession } from "./input";
import { correctionPairs } from "./pairs";
import { recipeSignals } from "./signals";
import { insertCard } from "./store";
import {
  cardTitle,
  type Card,
  type Destination,
  type Pair,
  type SessionInput,
} from "./types";

const ID = "learning-cards" as const;
const LESSON_MAX = 200;
const TASK_MAX = 600;

const inFlight = new Set<string>();

const LESSON_SYSTEM = `You judge whether a few corrections from one finished agent session are worth keeping for next time. Reply reusable=false for anything specific to that one piece of work. Otherwise give one plain line (the lesson, under ${LESSON_MAX} characters) and where it belongs:
- "recipe": the session ran from a saved recipe and the lesson is about running that recipe.
- "claude_md": a fact about the repository (how to build, test, run or avoid breaking it) that every future agent there should know.
- "check": better caught by a script or automated check; put a short task brief for it in taskPrompt instead of a lesson.
- "rule": only a preference about how work is done in this workspace (process, style, when to ask), never a fact about code.
${UNTRUSTED_RULE}`;
const LESSON_SCHEMA = {
  type: "object",
  properties: {
    reusable: { type: "boolean" },
    lesson: { type: "string" },
    destination: { enum: ["recipe", "claude_md", "check", "rule"] },
    taskPrompt: { type: "string" },
  },
  required: ["reusable", "lesson", "destination"],
};

interface Where {
  recipe: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  repo: boolean;
  workspaceId: string | null;
}

function whereOf(input: SessionInput): Where {
  const project = input.projectId ? getProject(input.projectId) : null;
  const usable = project && !project.is_uncategorized ? project : null;
  const recipe = input.run ? getRecipe(input.run.recipeId) : null;
  return {
    recipe: recipe ? { id: recipe.id, name: recipe.name } : null,
    project: usable ? { id: usable.id, name: usable.name } : null,
    repo: !!usable && input.inRepo && !isRemoteHost(usable.host_id),
    workspaceId: input.workspaceId,
  };
}

export interface Verdict {
  reusable?: unknown;
  lesson?: unknown;
  destination?: unknown;
  taskPrompt?: unknown;
}

// What the model said, held to what the session can actually do. Null: no card.
export function checkLesson(
  v: Verdict | null,
  where: Where
): { lesson: string; destination: Destination; taskPrompt?: string } | null {
  if (!v || v.reusable !== true || typeof v.lesson !== "string") return null;
  const lesson = v.lesson.replace(/\s+/g, " ").trim().slice(0, LESSON_MAX);
  const task =
    typeof v.taskPrompt === "string"
      ? v.taskPrompt.trim().slice(0, TASK_MAX)
      : "";
  let destination = v.destination as Destination;
  // Not run from a recipe: its lesson is a repo fact, if there is a repo.
  if (destination === "recipe" && !where.recipe) destination = "claude_md";
  switch (destination) {
    case "recipe":
      return lesson ? { lesson, destination } : null;
    case "claude_md":
      return lesson && where.repo && where.project
        ? { lesson, destination }
        : null;
    case "check":
      return task && where.project
        ? {
            lesson: lesson || task.slice(0, LESSON_MAX),
            destination,
            taskPrompt: task,
          }
        : null;
    case "rule":
      return lesson && where.workspaceId ? { lesson, destination } : null;
    default:
      return null;
  }
}

const pairsText = (pairs: Pair[]) =>
  pairs
    .map((p, i) => `${i + 1}. [${p.kind}] ${p.before}\n   then: ${p.after}`)
    .join("\n");

export async function analyzeSession(
  sessionId: string,
  how: EndHow,
  runner: ClaudeRunner = runClaude
): Promise<void> {
  if (!experimentOn(ID)) return;
  if (
    inFlight.has(sessionId) ||
    hasEvent(ID, sessionId, "script", "session-end")
  )
    return;
  inFlight.add(sessionId);
  try {
    const input = await readSession(sessionId);
    if (!input || input.skip) return;
    // A recipe run's session ends before the run settles; its settle comes.
    if (input.run && !input.run.settled && how !== "recipe-settled") return;

    const ctx = { sessionId, workspaceId: input.workspaceId };
    const recipe = recipeSignals(input);
    const pairs = correctionPairs(input);
    countEvent(ID, "script", {
      ...ctx,
      trigger: "session-end",
      detail: `signals: ${recipe.signals.join(",") || "none"}; pairs: ${pairs.length}`,
    });

    const made: Card[] = [];
    if (recipe.hit && input.workspaceId) {
      try {
        recipePrefill(sessionId);
        const out = await experimentRun(
          ID,
          { ...ctx, trigger: "recipe-draft" },
          {
            ...draftRequest(input.brief, input.final, true),
            workspaceId: input.workspaceId,
          },
          runner
        );
        const draft = parseDraft(out);
        if (
          (out as { repeatable?: unknown } | null)?.repeatable === true &&
          draft
        ) {
          const card = insertCard({
            sessionId,
            workspaceId: input.workspaceId,
            kind: "recipe",
            payload: { signals: recipe.signals, ...draft },
          });
          if (card) made.push(card);
        }
      } catch (error) {
        console.warn("[learning-cards] recipe draft:", error);
      }
    }

    if (pairs.length) {
      try {
        const where = whereOf(input);
        const out = (await experimentRun(
          ID,
          { ...ctx, trigger: "lesson" },
          {
            cwd: os.tmpdir(),
            system: LESSON_SYSTEM,
            prompt: [
              where.recipe
                ? `The session ran from the recipe "${where.recipe.name}".`
                : "The session did not run from a recipe.",
              untrusted("session corrections", pairsText(pairs)),
            ].join("\n\n"),
            schema: LESSON_SCHEMA,
            tools: [],
            role: "helper",
            timeoutMs: 20_000,
            workspaceId: input.workspaceId ?? undefined,
          },
          runner
        )) as Verdict | null;
        const ok = checkLesson(out, where);
        if (ok) {
          const card = insertCard({
            sessionId,
            workspaceId: input.workspaceId,
            kind: "lesson",
            destination: ok.destination,
            payload: {
              ...ok,
              recipeId: where.recipe?.id,
              recipeName: where.recipe?.name,
              projectId: where.project?.id,
              projectName: where.project?.name,
              pairs: pairs.length,
            },
          });
          if (card) made.push(card);
        }
      } catch (error) {
        console.warn("[learning-cards] lesson:", error);
      }
    }

    // One line per card, once: the key is the card, so a rerun or a restart
    // tells the orchestrator nothing new.
    if (input.workspaceId && getOrchestrator(input.workspaceId))
      for (const card of made)
        queueEventOnce(
          input.workspaceId,
          `learning-card:${card.id}`,
          sessionId,
          `Learning card on "${input.name.replace(/\s+/g, " ")}", waiting on Saad's Needs-you strip: ${untrusted("learning card", cardTitle(card))}`
        );
  } finally {
    inFlight.delete(sessionId);
  }
}
