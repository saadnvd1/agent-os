/**
 * Tasks ↔ cards (docs/lumifyhub.md, "What maps to what"). A task in a
 * project with a linked board gets a card, and the card moves as the task
 * runs. All of it is best effort: a LumifyHub outage never breaks a task.
 */

import {
  db,
  queries,
  lumifyhubQueries as q,
  type Project,
  type Session,
} from "../db";
import { getProject, getAllProjects } from "../projects";
import type { TaskPR, TaskState } from "../tasks/state";
import { connectedClient, forgetIfDisconnected } from "./connection";
import { cardTargetFor, ensureTaskLists, forgetLists } from "./lists";
import { linkedWorkspaceFor } from "./links";
import { cardUrl } from "./urls";
import { richTextToPlain } from "./rich-text";
import type { BoardTodo, LhCard } from "./types";

function report(what: string, error: unknown): void {
  forgetIfDisconnected(error);
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[lumifyhub] ${what}: ${reason}`);
}

// Fire and forget, with errors logged.
export function inBackground(what: string, fn: () => Promise<unknown>): void {
  fn().catch((error) => report(what, error));
}

export function cardTitle(prompt: string): string {
  const line = prompt.trim().split("\n")[0].trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

// Card work for one task runs one job at a time, in order. Each sync re-reads
// the session row and applies the latest state asked for, so a change that
// arrives mid-sync is never lost and a comment is never posted twice.
const queues = new Map<string, Promise<void>>();
const wanted = new Map<string, { state: TaskState; pr: TaskPR | null }>();

function serially(sessionId: string, job: () => Promise<void>): Promise<void> {
  const run = (queues.get(sessionId) ?? Promise.resolve()).then(job);
  const tail = run.catch(() => {});
  queues.set(sessionId, tail);
  tail.then(() => {
    if (queues.get(sessionId) !== tail) return;
    queues.delete(sessionId);
    wanted.delete(sessionId);
  });
  return run;
}

// Give a new task its card: an existing one it was started from, or a new
// card in To Do. Then move it to where the task is.
export function attachTaskCard(
  session: Session,
  project: Project,
  existingCardId?: string
): Promise<void> {
  const boardId = project.lh_board_id;
  const client = connectedClient();
  if (!boardId || !client) return Promise.resolve();
  if (!wanted.has(session.id)) {
    wanted.set(session.id, { state: "working", pr: null });
  }
  return serially(session.id, async () => {
    let cardId = existingCardId;
    if (!cardId) {
      const lists = await ensureTaskLists(client, boardId);
      const prompt = session.task_prompt || session.name;
      const card = await client.createCard(boardId, {
        list_id: lists.todo,
        title: cardTitle(prompt),
        description: prompt,
      });
      cardId = card.id;
    }
    q.linkTaskCard(db, session.id, { cardId, boardId, list: "todo" });
    await applyLatest(session.id);
  });
}

// Move the card to the list for the task's state, once per change.
export function syncTaskCard(
  session: Session,
  state: TaskState,
  pr: TaskPR | null
): Promise<void> {
  wanted.set(session.id, { state, pr });
  return serially(session.id, () => applyLatest(session.id));
}

async function applyLatest(sessionId: string): Promise<void> {
  const want = wanted.get(sessionId);
  const row = queries.getSession(db).get(sessionId) as Session | undefined;
  const client = connectedClient();
  if (!want || !row || !client) return;
  const { lh_card_id: cardId, lh_board_id: boardId } = row;
  if (!cardId || !boardId) return;
  const target = cardTargetFor(want.state);
  if (row.lh_card_list === target) return;
  if (target === "failed" || target === "dropped") {
    await client.addComment(
      boardId,
      cardId,
      target === "dropped"
        ? "AgentOS: the task was dropped."
        : "AgentOS: the agent exited without opening a pull request."
    );
  } else {
    let lists = await ensureTaskLists(client, boardId);
    try {
      await client.moveCard(boardId, cardId, lists[target]);
    } catch {
      // A list may have been deleted since it was cached.
      forgetLists(boardId);
      lists = await ensureTaskLists(client, boardId, true);
      await client.moveCard(boardId, cardId, lists[target]);
    }
    if (target === "in_review" && want.pr?.url) {
      await client.addComment(
        boardId,
        cardId,
        `AgentOS opened a pull request: ${want.pr.url}`
      );
    }
  }
  q.setTaskCardList(db, sessionId, target);
}

// The session object a caller holds may be stale (even predate its card), so
// this always queues; the run reads the row and no-ops if nothing changed.
export function syncTaskCardInBackground(
  session: Session,
  state: TaskState,
  pr: TaskPR | null
): void {
  inBackground(`sync card for task ${session.id}`, () =>
    syncTaskCard(session, state, pr)
  );
}

function boardProjects(): Project[] {
  return getAllProjects().filter(
    (p) =>
      p.lh_board_id &&
      !p.is_uncategorized &&
      (!p.host_id || p.host_id === "local")
  );
}

// The To Do cards on each linked board that no task has taken yet.
export async function boardTodos(): Promise<BoardTodo[]> {
  const client = connectedClient();
  if (!client) return [];
  const projects = boardProjects();
  return Promise.all(
    projects.map(async (project) => {
      const boardId = project.lh_board_id!;
      const slug = linkedWorkspaceFor(project).lh_workspace_slug!;
      const lists = await ensureTaskLists(client, boardId);
      const taken = q.linkedCardIds(db, boardId);
      const cards = (await client.listCards(boardId, lists.todo)).filter(
        (c) => !taken.has(c.id)
      );
      return {
        projectId: project.id,
        projectName: project.name,
        boardName: project.lh_board_name,
        cards: cards.map((c) => ({
          id: c.id,
          ticket: c.ticket,
          title: c.title,
          url: cardUrl(client.baseUrl, slug, project.lh_board_page_id, c.id),
        })),
      };
    })
  );
}

export function promptFromCard(card: LhCard): string {
  const description = richTextToPlain(card.description);
  return description ? `${card.title}\n\n${description}` : card.title;
}

export async function cardForTask(
  projectId: string,
  cardId: string
): Promise<{ project: Project; card: LhCard }> {
  const project = getProject(projectId);
  const client = connectedClient();
  if (!project?.lh_board_id) throw new Error("This project has no board");
  if (!client) throw new Error("LumifyHub is not connected");
  if (q.linkedCardIds(db, project.lh_board_id).has(cardId)) {
    throw new Error("A task is already running for this card");
  }
  const card = await client.getCard(project.lh_board_id, cardId);
  return { project, card };
}

export function taskCardUrl(session: Session): string | null {
  const client = connectedClient();
  const project = session.project_id ? getProject(session.project_id) : null;
  if (!client || !project || !session.lh_card_id) return null;
  try {
    const slug = linkedWorkspaceFor(project).lh_workspace_slug!;
    return cardUrl(
      client.baseUrl,
      slug,
      project.lh_board_page_id,
      session.lh_card_id
    );
  } catch {
    return null;
  }
}
