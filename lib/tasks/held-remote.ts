/**
 * An orchestrator's calls on a task it moved to a linked machine, which that
 * machine's AgentOS answers for the device that sent the task (held.ts). The
 * orchestrator polls and calls; the other machine never reaches back.
 */

import type { Session } from "../db";
import { cleanRemoteText, hostApi, requireHostLink } from "../hosts/remote-api";
import type { Delivery } from "../bus/delivery";

const path = (id: string, leaf: string) =>
  `/api/tasks/${encodeURIComponent(id)}/${leaf}`;

/**
 * Delivered by that machine's AgentOS as a message from the orchestrator,
 * never as the user's own. Keyed by the stored message, so a retry that
 * already landed is not typed twice.
 */
export async function relayToHeldTask(
  to: Session,
  line: string,
  fromName: string,
  messageId?: number
): Promise<Delivery> {
  try {
    const link = requireHostLink(to.host_id);
    const { state } = await hostApi<{ state?: unknown }>(
      link,
      path(to.id, "message"),
      {
        body: {
          id: messageId ? `bus-${messageId}` : undefined,
          line,
          from: fromName,
        },
        timeout: 20000,
      }
    );
    return { state: state === "queued" ? "queued" : "delivered" };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { state: "failed", why: why.slice(0, 300) };
  }
}

/** A held chat task's last lines of conversation, as that machine reads them. */
export async function heldChatTail(
  task: Session,
  lines: number
): Promise<string | null> {
  const link = requireHostLink(task.host_id);
  const { text } = await hostApi<{ text?: unknown }>(
    link,
    `${path(task.id, "chat-tail")}?lines=${lines}`,
    { timeout: 10000 }
  ).catch(() => ({ text: undefined }));
  return typeof text === "string" ? cleanRemoteText(text) : null;
}

/** Stops its agent there; its conversation and worktree are kept. */
export async function stopHeldTask(
  task: Pick<Session, "id" | "name" | "host_id">
): Promise<string> {
  const link = requireHostLink(task.host_id);
  const { text } = await hostApi<{ text?: unknown }>(
    link,
    path(task.id, "stop"),
    {
      body: {},
      timeout: 30000,
    }
  );
  return cleanRemoteText(text) || `Stopped ${task.name}.`;
}

/** Done there: its agent stops and its worktree goes. Never a merge. */
export async function doneHeldTask(task: Session): Promise<void> {
  const link = requireHostLink(task.host_id);
  await hostApi(link, path(task.id, "done"), { body: {}, timeout: 120000 });
}
