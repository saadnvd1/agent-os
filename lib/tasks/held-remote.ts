/**
 * An orchestrator's calls on a task it moved to a linked machine, which that
 * machine's AgentOS answers for the device that sent the task (held.ts). The
 * orchestrator polls and calls; the other machine never reaches back.
 */

import { db, type Session } from "../db";
import {
  HostApiError,
  cleanRemoteBlock,
  cleanRemoteText,
  hostApi,
  hostLink,
  requireHostLink,
} from "../hosts/remote-api";
import type { Delivery } from "../bus/delivery";
import { wakeLine } from "../bus/format";
import { orchestratedStart } from "./held";

const path = (id: string, leaf: string) =>
  `/api/tasks/${encodeURIComponent(id)}/${leaf}`;

/**
 * A task its orchestrator put on a linked machine, whether by moving it or
 * by the queue placing it there: the one test every relayed call goes by.
 * (held-replies.ts reads the same rule in SQL: started_by IS NOT NULL.)
 */
export const isHeldRemote = (
  s: Pick<Session, "started_by" | "task_prompt" | "host_id">
): boolean => !!s.started_by && !!s.task_prompt && !!hostLink(s.host_id);

type Held = Pick<
  Session,
  "id" | "name" | "host_id" | "started_by" | "task_since" | "task_prompt"
>;

const ADOPT_RETRY_MS = 5 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const g = globalThis as unknown as { __agentosAdopted?: Map<string, number> };
const adopted = (g.__agentosAdopted ??= new Map());

/**
 * A task the queue placed before machines held them is unheld there, so its
 * calls are refused as "No such held task". Asks the machine to hold it for
 * this one, then sends what was left undelivered. False when it can't.
 */
async function adoptHeld(task: Held): Promise<boolean> {
  const now = Date.now();
  // Only failures are remembered, and only for the retry window.
  for (const [id, at] of adopted)
    if (now - at >= ADOPT_RETRY_MS) adopted.delete(id);
  if (adopted.has(task.id)) return false;
  adopted.set(task.id, now);
  try {
    const link = requireHostLink(task.host_id);
    await hostApi(link, path(task.id, "hold"), {
      body: {
        orchestrated: orchestratedStart(
          task.started_by!,
          task.task_since ?? null
        ),
      },
      timeout: 20000,
    });
  } catch {
    return false;
  }
  adopted.delete(task.id);
  await flushUndelivered(task);
  return true;
}

/** The call, held first if that machine says it isn't, once. */
async function withHold<T>(task: Held, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof HostApiError) || error.status !== 404) throw error;
    if (!(await adoptHeld(task))) throw error;
    return call();
  }
}

/**
 * Messages stored for the task while it couldn't be reached: sent now, each
 * keyed by its stored id so one that did land isn't typed twice. Ones older
 * than a day are marked read, not replayed into a later context.
 */
export async function flushUndelivered(
  task: Pick<
    Session,
    "id" | "host_id" | "started_by" | "task_since" | "task_prompt" | "name"
  >
): Promise<void> {
  const rows = db
    .prepare(
      `SELECT id, from_id, from_name, body, created_at FROM bus_messages
       WHERE to_id = ? AND delivered_at IS NULL AND read_at IS NULL
         AND held_pause_id IS NULL ORDER BY id`
    )
    .all(task.id) as {
    id: number;
    from_id: string | null;
    from_name: string;
    body: string;
    created_at: string;
  }[];
  for (const m of rows) {
    const age = Date.now() - Date.parse(`${m.created_at.replace(" ", "T")}Z`);
    if (age > STALE_MS) {
      db.prepare(
        `UPDATE bus_messages SET read_at = datetime('now') WHERE id = ?`
      ).run(m.id);
      continue;
    }
    const line = wakeLine({
      fromName: m.from_name,
      fromId: m.from_id,
      body: m.body,
    });
    const res = await relayToHeldTask(task, line, m.from_name, m.id, false);
    if (res.state === "failed") return;
    db.prepare(
      `UPDATE bus_messages SET delivered_at = datetime('now') WHERE id = ?`
    ).run(m.id);
  }
}

/**
 * Delivered by that machine's AgentOS as a message from the orchestrator,
 * never as the user's own. Keyed by the stored message, so a retry that
 * already landed is not typed twice.
 */
export async function relayToHeldTask(
  to: Held,
  line: string,
  fromName: string,
  messageId?: number,
  heal = true
): Promise<Delivery> {
  try {
    const link = requireHostLink(to.host_id);
    const send = () =>
      hostApi<{ state?: unknown }>(link, path(to.id, "message"), {
        body: {
          id: messageId ? `bus-${messageId}` : undefined,
          line,
          from: fromName,
        },
        timeout: 20000,
      });
    const { state } = await (heal ? withHold(to, send) : send());
    return { state: state === "queued" ? "queued" : "delivered" };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { state: "failed", why: why.slice(0, 300) };
  }
}

/** A held chat task's last lines of conversation, as that machine reads them. */
export async function heldChatTail(
  task: Held,
  lines: number
): Promise<string | null> {
  const link = requireHostLink(task.host_id);
  const { text } = await withHold(task, () =>
    hostApi<{ text?: unknown }>(
      link,
      `${path(task.id, "chat-tail")}?lines=${lines}`,
      { timeout: 10000 }
    )
  ).catch(() => ({ text: undefined }));
  // Whole lines, as a local read has them (read.ts caps and trims them).
  return typeof text === "string" ? cleanRemoteBlock(text, 16000) : null;
}

/**
 * What its chat says about being blocked or asking, as that machine reads it
 * (the same reading a local chat task gets). Null when it can't be asked,
 * which callers treat as unread, never as clear.
 */
export async function heldChatFacts(
  task: Held
): Promise<{ blocked: string | null; turn: string | null } | null> {
  const link = requireHostLink(task.host_id);
  const res = await withHold(task, () =>
    hostApi<{ blocked?: unknown; turn?: unknown }>(
      link,
      path(task.id, "chat-facts"),
      { timeout: 10000 }
    )
  ).catch(() => null);
  if (!res || (res.blocked !== null && typeof res.blocked !== "string"))
    return null;
  if (res.turn !== null && typeof res.turn !== "string") return null;
  return {
    blocked: res.blocked ? cleanRemoteBlock(res.blocked, 2000) : null,
    turn: res.turn,
  };
}

/** Stops its agent there; its conversation and worktree are kept. */
export async function stopHeldTask(task: Held): Promise<string> {
  const link = requireHostLink(task.host_id);
  const { text } = await withHold(task, () =>
    hostApi<{ text?: unknown }>(link, path(task.id, "stop"), {
      body: {},
      timeout: 30000,
    })
  );
  return cleanRemoteText(text) || `Stopped ${task.name}.`;
}

/** Done there: its agent stops and its worktree goes. Never a merge. */
export async function doneHeldTask(task: Held): Promise<void> {
  const link = requireHostLink(task.host_id);
  await withHold(task, () =>
    hostApi(link, path(task.id, "done"), { body: {}, timeout: 120000 })
  );
}
