import { randomUUID } from "crypto";
import { db, stackQueries as q, type NewStackItem, type StackRow } from "../db";
import { getProject } from "../projects";
import { readBoard } from "./board";
import { planStack, type PlanItem } from "./plan";
import { depths } from "./view";
import type { StackItemView, StackPreview } from "./types";

const STORED = new Set(["planned", "held", "running"]);

// Rows for the cards a stack runs: planned, held, and ones already running.
// Done and excluded cards are not stored; a blocker among them stays a note.
export function itemsFromPlan(
  plan: PlanItem[],
  newId: () => string = randomUUID
): NewStackItem[] {
  const kept = plan.filter((p) => STORED.has(p.status));
  const ids = new Map(kept.map((p) => [p.cardId, newId()]));
  const mapIds = (cards: string[]) =>
    JSON.stringify(cards.filter((c) => ids.has(c)).map((c) => ids.get(c)!));
  return kept.map((p, position) => ({
    id: ids.get(p.cardId)!,
    position,
    lh_card_id: p.cardId,
    ticket: p.ticket,
    title: p.title,
    parent_item_id: p.parent ? (ids.get(p.parent) ?? null) : null,
    also_item_ids: mapIds(p.also),
    blocker_item_ids: mapIds(p.blockers),
    status:
      p.status === "running"
        ? "running"
        : p.status === "held"
          ? "held"
          : "planned",
    session_id: p.sessionId,
    base_branch: null,
    base_tip: null,
    note:
      p.status === "running"
        ? "Already had a task; it was started off the default branch"
        : p.note,
  }));
}

function previewItems(
  plan: PlanItem[],
  cardUrl: (id: string) => string | null
): StackItemView[] {
  const name = new Map(plan.map((p) => [p.cardId, p.ticket || p.title]));
  const depth = depths(plan.map((p) => ({ id: p.cardId, parentId: p.parent })));
  return plan.map((p) => {
    const blockers = p.blockers.map((b) => name.get(b) ?? b);
    return {
      id: p.cardId,
      cardId: p.cardId,
      ticket: p.ticket,
      title: p.title,
      status: p.status,
      depth: depth.get(p.cardId) ?? 0,
      parentId: p.parent,
      also: p.also.map((a) => name.get(a) ?? a),
      waitsOn:
        p.status === "planned" && blockers.length
          ? `Waits on ${blockers.join(", ")}'s PR`
          : null,
      note: p.note,
      error: null,
      taskId: p.sessionId,
      prNumber: null,
      prUrl: null,
      baseBranch: null,
      cardUrl: cardUrl(p.cardId),
    };
  });
}

function projectOrThrow(projectId: string) {
  const project = getProject(projectId);
  if (!project || project.is_uncategorized) throw new Error("Pick a project");
  if (project.host_id && project.host_id !== "local") {
    throw new Error("Stacks run on this machine only for now");
  }
  return project;
}

export async function previewStack(projectId: string): Promise<StackPreview> {
  const project = projectOrThrow(projectId);
  const board = await readBoard(project);
  return {
    projectId: project.id,
    projectName: project.name,
    boardName: project.lh_board_name,
    items: previewItems(planStack(board.plan), board.cardUrl),
  };
}

export async function createStack(opts: {
  projectId: string;
  maxParallel?: number;
}): Promise<StackRow> {
  const project = projectOrThrow(opts.projectId);
  const board = await readBoard(project);
  const open = q.openForBoard(db, project.lh_board_id!);
  if (open) throw new Error(`"${open.name}" is already running on this board`);
  const items = itemsFromPlan(planStack(board.plan));
  if (!items.some((i) => i.status === "planned" || i.status === "running")) {
    throw new Error("Nothing to stack: the board has no open cards to start");
  }
  const id = randomUUID();
  const max = Math.min(Math.max(Math.floor(opts.maxParallel ?? 3), 1), 10);
  q.create(
    db,
    {
      id,
      project_id: project.id,
      lh_board_id: project.lh_board_id!,
      name: project.lh_board_name || project.name,
      max_parallel: max,
    },
    items
  );
  return q.get(db, id)!;
}
