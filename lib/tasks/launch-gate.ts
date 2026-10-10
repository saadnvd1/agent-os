// Before a task's agent launches, nothing may start it early: not opening
// its terminal, nor a message to its chat. Database only, so the chat
// runner can ask without loading the task modules.

import { db } from "../db";

// A task whose agent hasn't launched yet: opening it must not create its
// tmux session, or the launch would find a bare agent in its place.
export function launchPending(sessionId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM sessions WHERE id = ? AND task_status = 'running'
         AND setup_status IN ('running', 'held')`
    )
    .get(sessionId);
  return !!row;
}

// A chat task's first message, under one id: a start resumed after a
// restart neither loses it nor sends it twice. It alone may go out while
// the launch is pending; anything sent before it waits in the queue.
export const firstMessageId = (sessionId: string) =>
  `user-task-start-${sessionId}`;
