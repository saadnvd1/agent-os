/**
 * A task's plan as the list shows it: whether one is being written, waits for
 * a decision, or was approved, with its title and a capped piece of text.
 * Two sources: a chat in plan mode proposes one (a "plan" item, carried out
 * when approved), and the plan step writes one to a file in the worktree.
 */

import fs from "fs";
import path from "path";
import { db, type Session } from "../db";
import { PLAN_FILE, planSummary } from "../models/plan-step";
import { PLAN_TEXT_MAX, type TaskPlan } from "./loop-types";
import { expandHome } from "./session";

const TITLE_MAX = 120;

export function planTitle(text: string): string | null {
  const heading = /^#{1,6}\s+(.+)$/m.exec(text)?.[1]?.trim();
  const title = heading ?? planSummary(text, 1)[0] ?? null;
  if (!title) return null;
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

function chatPlan(
  sessionId: string
): { text: string; carried: boolean } | null {
  const row = db
    .prepare(
      `SELECT data FROM chat_items WHERE session_id = ?
         AND json_extract(data, '$.kind') = 'plan' ORDER BY seq DESC LIMIT 1`
    )
    .get(sessionId) as { data: string } | undefined;
  if (!row) return null;
  try {
    const item = JSON.parse(row.data) as { plan?: unknown; carried?: boolean };
    return typeof item.plan === "string"
      ? { text: item.plan, carried: !!item.carried }
      : null;
  } catch {
    return null;
  }
}

// Only the first `max` bytes, not the whole file.
function readHead(file: string, max: number): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(max + 1);
    const n = fs.readSync(fd, buf, 0, max + 1, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function capped(text: string) {
  const over = text.length > PLAN_TEXT_MAX;
  return { text: over ? text.slice(0, PLAN_TEXT_MAX) : text, truncated: over };
}

export function taskPlan(session: Session): TaskPlan | null {
  const decided = session.plan_decided ?? null;
  const phase = session.plan_phase ?? null;
  // Only a chat in plan mode is asked: listing tasks must stay cheap.
  const maybeChat = !!session.chat_plan;
  if (decided === null && !phase && !maybeChat) return null;

  const base = {
    planned: decided === null ? false : !!decided,
    reason: session.plan_reason ?? null,
  };
  const none = {
    ...base,
    status: null,
    source: null,
    title: null,
    path: null,
    text: null,
    truncated: false,
  } satisfies TaskPlan;

  const chat = maybeChat ? chatPlan(session.id) : null;
  if (chat && !chat.carried)
    return {
      ...base,
      planned: true,
      status: "ready",
      source: "chat",
      title: planTitle(chat.text),
      path: null,
      ...capped(chat.text),
    };

  if (phase && session.worktree_path) {
    const file = path.join(expandHome(session.worktree_path), PLAN_FILE);
    const text = readHead(file, PLAN_TEXT_MAX);
    if (text !== null || phase === "planning") {
      const body = text ?? "";
      return {
        ...base,
        planned: true,
        status: phase === "planning" ? "writing" : "approved",
        source: "step",
        title: planTitle(body),
        path: text !== null ? PLAN_FILE : null,
        ...capped(body),
      };
    }
  }

  if (chat)
    return {
      ...base,
      planned: true,
      status: "approved",
      source: "chat",
      title: planTitle(chat.text),
      path: null,
      ...capped(chat.text),
    };

  if (decided === null) return null;
  return none;
}
