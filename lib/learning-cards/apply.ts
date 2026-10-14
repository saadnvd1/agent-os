// What a tap on a card does. The only place a lesson is written anywhere.

import fs from "fs";
import path from "path";
import { db } from "../db";
import { countEvent } from "../experiments/meter";
import { experimentOn } from "../experiments";
import { getOrchestrator } from "../orchestrator/home";
import { quickPR, startQuickChange } from "../orchestrator/quick";
import { addRule } from "../orchestrator/rules";
import { isRemoteHost } from "../hosts";
import { getProject } from "../projects";
import { createRecipe, getRecipe, updateRecipe } from "../recipes/store";
import { recipePrefill } from "../recipes/draft";
import { createTask } from "../tasks";
import { claimCard, getCard, releaseCard, settleCard } from "./store";
import type { Card, LessonPayload, RecipePayload } from "./types";

const ID = "learning-cards" as const;
const HEADING = "## Lessons";

export class CardRefused extends Error {}

export interface Edits {
  lesson?: string;
  brief?: string;
  taskPrompt?: string;
}

// CLAUDE.md with the line under "## Lessons" (the heading made if missing).
export function withLesson(text: string, line: string): string {
  const bullet = `- ${line.replace(/\s+/g, " ").trim()}`;
  const lines = text.replace(/\s+$/, "").split("\n");
  const at = lines.findIndex((l) => l.trim() === HEADING);
  if (at === -1)
    return `${text.trim() ? `${lines.join("\n")}\n\n` : ""}${HEADING}\n\n${bullet}\n`;
  let end = at + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++;
  while (end > at + 1 && !lines[end - 1].trim()) end--;
  if (lines.slice(at + 1, end).some((l) => l.trim() === bullet))
    return `${lines.join("\n")}\n`;
  lines.splice(end, 0, ...(end === at + 1 ? ["", bullet] : [bullet]));
  return `${lines.join("\n")}\n`;
}

const clean = (s: string | undefined, max: number) =>
  (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

async function toClaudeMd(card: Card, p: LessonPayload, line: string) {
  const project = p.projectId ? getProject(p.projectId) : null;
  if (!project) throw new CardRefused("That project is gone");
  const workspaceId = card.workspace_id;
  const source = (
    db
      .prepare(`SELECT name FROM sessions WHERE id = ?`)
      .get(card.session_id) as { name: string } | undefined
  )?.name;
  if (
    workspaceId &&
    getOrchestrator(workspaceId) &&
    !isRemoteHost(project.host_id)
  ) {
    const quick = await startQuickChange(
      workspaceId,
      project.id,
      "Add a lesson to CLAUDE.md"
    );
    const file = path.join(quick.worktreePath, "CLAUDE.md");
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    fs.writeFileSync(file, withLesson(before, line));
    await quickPR(
      workspaceId,
      quick.id,
      "docs: add a lesson to CLAUDE.md",
      `${line}${source ? `\n\nFrom the session "${source}".` : ""}`
    );
    return quick.id;
  }
  const task = await createTask({
    projectId: project.id,
    prompt: `Add exactly this line under a "${HEADING}" heading in CLAUDE.md at the repository root, creating the file and heading if missing, and change nothing else: ${line}`,
    startedBy: null,
  });
  return task.id;
}

async function applyLesson(card: Card, p: LessonPayload, edits: Edits) {
  const line = clean(edits.lesson, 200) || p.lesson;
  switch (p.destination) {
    case "recipe": {
      const recipe = p.recipeId ? getRecipe(p.recipeId) : null;
      if (!recipe || recipe.archived_at)
        throw new CardRefused("That recipe is gone");
      updateRecipe(
        recipe.id,
        { brief: `${recipe.brief}\n\nLesson: ${line}` },
        null
      );
      return recipe.id;
    }
    case "claude_md":
      return toClaudeMd(card, p, line);
    case "check": {
      const prompt = clean(edits.taskPrompt, 600) || p.taskPrompt;
      if (!prompt || !p.projectId)
        throw new CardRefused("There's no task to start");
      return (
        await createTask({ projectId: p.projectId, prompt, startedBy: null })
      ).id;
    }
    case "rule":
      if (!card.workspace_id)
        throw new CardRefused("There's no workspace for a rule");
      return String(addRule(card.workspace_id, line, "saad").id);
  }
}

async function applyRecipe(card: Card, p: RecipePayload, edits: Edits) {
  const base = recipePrefill(card.session_id);
  const recipe = createRecipe(
    {
      workspaceId: base.workspaceId,
      projectId: base.projectId,
      name: base.name,
      kind: base.kind,
      brief: edits.brief?.trim() || p.brief,
      model: base.model ?? undefined,
      view: base.view,
      sourceSessionId: card.session_id,
    },
    null
  );
  return recipe.id;
}

function pending(cardId: number): Card {
  if (!experimentOn(ID)) throw new CardRefused("Learning cards are off");
  const card = getCard(cardId);
  if (!card) throw new CardRefused("No such card");
  if (card.status !== "pending") throw new CardRefused("Already decided");
  return card;
}

const meter = (card: Card, event: "accepted" | "dismissed") =>
  countEvent(
    ID,
    event,
    {
      trigger: "card-apply",
      sessionId: card.session_id,
      workspaceId: card.workspace_id,
      detail: card.kind === "lesson" ? `lesson: ${card.destination}` : "recipe",
    },
    true
  );

export async function applyCard(
  cardId: number,
  edits: Edits = {}
): Promise<Card> {
  const card = pending(cardId);
  if (!claimCard(cardId)) throw new CardRefused("Already decided");
  try {
    const ref =
      card.kind === "recipe"
        ? await applyRecipe(card, card.payload as RecipePayload, edits)
        : await applyLesson(card, card.payload as LessonPayload, edits);
    settleCard(cardId, "accepted", ref);
  } catch (error) {
    releaseCard(cardId);
    throw error;
  }
  meter(card, "accepted");
  return getCard(cardId)!;
}

export function dismissCard(cardId: number): Card {
  const card = pending(cardId);
  settleCard(cardId, "dismissed", null);
  meter(card, "dismissed");
  return getCard(cardId)!;
}

// The recipe form saved a recipe from this session: its card is taken.
export function acceptRecipeCardFor(sessionId: string, recipeId: string): void {
  if (!experimentOn(ID)) return;
  const row = db
    .prepare(
      `SELECT id FROM learning_cards WHERE session_id = ? AND kind = 'recipe' AND status = 'pending'`
    )
    .get(sessionId) as { id: number } | undefined;
  if (!row || !claimCard(row.id)) return;
  const card = getCard(row.id)!;
  settleCard(row.id, "accepted", recipeId);
  meter(card, "accepted");
}
