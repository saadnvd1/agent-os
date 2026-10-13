/**
 * One helper per event that can reach the phone. Each is fire-and-forget:
 * a failure here must never touch the code that raised the event.
 */

import { db } from "../../db";
import { pushEvent } from "./index";
import type { PushEvent } from "../push-types";

function fire(event: PushEvent, sessionId?: string | null): void {
  pushEvent(event, { sessionId }).catch((error) =>
    console.error(
      `[push] ${event.category}:`,
      error instanceof Error ? error.message : error
    )
  );
}

export const pushAskRaised = (askId: number, workspaceId: string) =>
  fire({ category: "asks", id: workspaceId, key: `ask:${askId}` });

export const pushNeedsYou = (sessionId: string, armedAt: number) =>
  fire(
    {
      category: "needs-you",
      id: sessionId,
      key: `needs-you:${sessionId}:${armedAt}`,
      collapse: `needs-you:${sessionId}`,
    },
    sessionId
  );

const forTask = (
  category: "review" | "ci" | "merged",
  prefix: string,
  taskId: string,
  sha?: string | null
) =>
  fire(
    {
      category,
      id: taskId,
      key: `${prefix}:${taskId}${sha ? `:${sha}` : ""}`,
      collapse: `task:${taskId}`,
    },
    taskId
  );

export const pushReviewReady = (taskId: string, sha: string) =>
  forTask("review", "review", taskId, sha);
export const pushCiFailed = (taskId: string, sha: string) =>
  forTask("ci", "ci", taskId, sha);
export const pushReviewBlocked = (taskId: string, sha: string) =>
  forTask("ci", "review-block", taskId, sha);
// A piece of a feature is covered by the feature's own push when it closes.
const isFeaturePiece = (sessionId: string) =>
  !!db
    .prepare(`SELECT 1 FROM feature_pieces WHERE session_id = ?`)
    .get(sessionId);

export const pushMerged = (taskId: string) => {
  if (!isFeaturePiece(taskId)) forTask("merged", "merged", taskId);
};

export const pushFeatureMerged = (featureId: string, name: string) =>
  fire({
    category: "merged",
    id: null,
    key: `feature:${featureId}`,
    collapse: `group:feature:${featureId}`,
    title: "Feature merged",
    body: name,
  });

export const pushPlanAwaiting = (
  taskId: string,
  name: string,
  pieces: number
) =>
  fire(
    {
      category: "plan",
      id: taskId,
      key: `plan-ready:${taskId}`,
      collapse: `plan:${taskId}`,
      title: "Plan ready",
      body: `${name}, ${pieces} ${pieces === 1 ? "piece" : "pieces"}`,
    },
    taskId
  );

export const pushPlanReady = (sessionId: string, itemId: string) => {
  // Only a task has a screen to open; a plain chat's plan goes to the list.
  const task = db
    .prepare(`SELECT task_status FROM sessions WHERE id = ?`)
    .get(sessionId) as { task_status: string | null } | undefined;
  fire(
    {
      category: "review",
      id: task?.task_status ? sessionId : null,
      key: `plan:${sessionId}:${itemId}`,
      collapse: `plan:${sessionId}`,
    },
    sessionId
  );
};
