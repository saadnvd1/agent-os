/**
 * The one client for a task running on a linked machine: every call the Mac
 * makes to that machine's task API, with its path, body, timeout and retry in
 * one place. Callers hold a HostLink and say what they want; none of them
 * builds a task URL.
 */

import { MERGE_METHODS, type MergeMethod } from "../merge-methods";
import type { Session } from "../../db";
import {
  HostApiError,
  cleanRemoteBlock,
  cleanRemoteText,
  hostApi,
  type HostLink,
} from "../../hosts/remote-api";
import type { OrchestratedBundle } from "../move-bundle";
import type { TaskBundle } from "../move-bundle";
import {
  HELD_REPLIES,
  IMPORT,
  LIST,
  TIMEOUT,
  arrivedPath,
  taskPath,
} from "./routes";
import type { ChatFacts, HostTasks } from "./types";

export const unknownOutcome = (err: unknown) =>
  err instanceof HostApiError && !err.refused;

/** POST a call that's safe to repeat; once more if we can't tell it landed. */
export async function postIdempotent<T>(
  link: HostLink,
  path: string,
  body: unknown,
  timeout: number
): Promise<T> {
  try {
    return await hostApi<T>(link, path, { body, timeout });
  } catch (err) {
    if (!unknownOutcome(err)) throw err;
    return hostApi<T>(link, path, { body, timeout });
  }
}

/** POST, repeated when the outcome is unknown (the calls are idempotent). */
export async function tell(
  link: HostLink,
  path: string,
  body: object = {}
): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await hostApi(link, path, { body });
      return;
    } catch (err) {
      if (!unknownOutcome(err) || i === 2) throw err;
    }
  }
}

const cache = new Map<string, { at: number; list: Promise<HostTasks> }>();

/** The machine's task list; the last answer within 3 s unless `fresh`. */
export function list(link: HostLink, fresh = false): Promise<HostTasks> {
  const hit = cache.get(link.hostId);
  if (!fresh && hit && Date.now() - hit.at < 3000) return hit.list;
  const next = hostApi<HostTasks>(link, LIST, { timeout: TIMEOUT.list });
  cache.set(link.hostId, { at: Date.now(), list: next });
  next.catch(() => cache.delete(link.hostId));
  return next;
}

export const forget = (hostId: string) => cache.delete(hostId);

export async function view(
  link: HostLink,
  id: string,
  fresh = false
): Promise<HostTasks["tasks"][number] | undefined> {
  const { tasks } = await list(link, fresh);
  return (Array.isArray(tasks) ? tasks : []).find((t) => t?.id === id);
}

/**
 * A machine on an older AgentOS would take a chat task as a terminal one,
 * or an orchestrator's task as a plain one that anyone there could merge, or
 * refuse to hand one over.
 */
export async function requireCapability(
  link: HostLink,
  capability: string,
  what: string,
  verb = "move"
): Promise<void> {
  const { capabilities = [] } = await list(link, true).catch((err) => {
    throw new Error(
      `Can't ask ${link.hostName} whether it takes ${what}: ${(err as Error).message}`
    );
  });
  if (!capabilities.includes(capability))
    throw new Error(
      `${link.hostName}'s AgentOS can't ${verb} ${what} yet; update it first`
    );
}

export const start = (link: HostLink, body: object) =>
  postIdempotent<{ session: Session }>(link, LIST, body, TIMEOUT.start);

export async function plan(link: HostLink, id: string): Promise<string | null> {
  const { text } = await hostApi<{ text: string | null }>(
    link,
    taskPath(id, "plan"),
    { timeout: TIMEOUT.plan }
  );
  return text;
}

export const approvePlan = (link: HostLink, id: string, message?: string) =>
  hostApi<{ model?: string }>(link, taskPath(id, "approve-plan"), {
    body: message ? { message } : {},
    timeout: TIMEOUT.approvePlan,
  });

export async function hold(
  link: HostLink,
  id: string,
  orchestrated: OrchestratedBundle
): Promise<void> {
  await hostApi(link, taskPath(id, "hold"), {
    body: { orchestrated },
    timeout: TIMEOUT.hold,
  });
}

export async function message(
  link: HostLink,
  id: string,
  body: { id?: string; line: string; from: string }
): Promise<"queued" | "delivered"> {
  const { state } = await hostApi<{ state?: unknown }>(
    link,
    taskPath(id, "message"),
    { body, timeout: TIMEOUT.message }
  );
  return state === "queued" ? "queued" : "delivered";
}

export async function chatTail(
  link: HostLink,
  id: string,
  lines: number
): Promise<string | null> {
  const { text } = await hostApi<{ text?: unknown }>(
    link,
    `${taskPath(id, "chat-tail")}?lines=${lines}`,
    { timeout: TIMEOUT.chat }
  );
  // Whole lines, as a local read has them (read.ts caps and trims them).
  return typeof text === "string" ? cleanRemoteBlock(text, 16000) : null;
}

export async function chatFacts(
  link: HostLink,
  id: string
): Promise<ChatFacts | null> {
  const res = await hostApi<{ blocked?: unknown; turn?: unknown }>(
    link,
    taskPath(id, "chat-facts"),
    { timeout: TIMEOUT.chat }
  );
  if (res.blocked !== null && typeof res.blocked !== "string") return null;
  if (res.turn !== null && typeof res.turn !== "string") return null;
  return {
    blocked: res.blocked ? cleanRemoteBlock(res.blocked, 2000) : null,
    turn: res.turn,
  };
}

export async function stop(link: HostLink, id: string): Promise<string> {
  const { text } = await hostApi<{ text?: unknown }>(
    link,
    taskPath(id, "stop"),
    {
      body: {},
      timeout: TIMEOUT.stop,
    }
  );
  return cleanRemoteText(text);
}

export async function done(link: HostLink, id: string): Promise<void> {
  await hostApi(link, taskPath(id, "done"), {
    body: {},
    timeout: TIMEOUT.done,
  });
}

/** A merge returns the method that machine merged with; null when it doesn't say. */
export async function merge(
  link: HostLink,
  id: string,
  pin?: { head: string; base?: string | null },
  label = "it"
): Promise<{ head: string | null; method: MergeMethod | null }> {
  // An AgentOS that predates pinned merges would ignore the head and merge
  // whatever the PR is at: refuse before asking it.
  if (pin)
    await requireCapability(link, "pinned-merge", "a merge to a commit", "pin");
  const res = await hostApi<{ head?: string | null; method?: unknown }>(
    link,
    taskPath(id, "merge"),
    {
      // base: what the gates here were judged against; the machine that
      // merges compares the PR with it, not with a base only it recorded.
      body: {
        ...(pin && { head: pin.head }),
        ...(pin?.base && { base: pin.base }),
      },
      timeout: TIMEOUT.merge,
    }
  ).catch(async (err) => {
    if (!unknownOutcome(err)) throw err;
    // A proxy or a dropped connection after the merge ran answers 502 with
    // nothing from AgentOS: ask what state the task is in before failing.
    const merged = await view(link, id, true)
      .then((t) => t?.state === "merged")
      .catch(() => false);
    if (!merged)
      throw new Error(
        `${(err as Error).message}: couldn't confirm whether ${link.hostName} merged ${label}; check its PR before signing off again`
      );
    return { head: pin?.head ?? null, method: undefined };
  });
  forget(link.hostId);
  return {
    head: res.head ?? null,
    method: MERGE_METHODS.find((m) => m === res.method) ?? null,
  };
}

export async function drop(link: HostLink, id: string): Promise<void> {
  await hostApi(link, taskPath(id, "drop"), {
    body: {},
    timeout: TIMEOUT.merge,
  });
  forget(link.hostId);
}

export const resume = (link: HostLink, id: string, body: object = {}) =>
  tell(link, taskPath(id, "resume"), body);

export const confirmMoved = (link: HostLink, id: string, to: string) =>
  tell(link, taskPath(id, "moved"), { to });

export async function exportOut(
  link: HostLink,
  id: string,
  to: string
): Promise<TaskBundle> {
  const { bundle } = await postIdempotent<{ bundle: TaskBundle }>(
    link,
    taskPath(id, "export"),
    { to },
    TIMEOUT.exportOut
  );
  return bundle;
}

export const importBundle = (link: HostLink, bundle: TaskBundle) =>
  postIdempotent<{ session: Session }>(
    link,
    IMPORT,
    bundle,
    TIMEOUT.importBundle
  );

export async function arrived(
  link: HostLink,
  from: string
): Promise<Session | null> {
  const { session } = await hostApi<{ session: Session | null }>(
    link,
    arrivedPath(from)
  );
  return session;
}

export const replies = (link: HostLink) =>
  hostApi<{ messages?: unknown }>(link, HELD_REPLIES, {
    timeout: TIMEOUT.replies,
  });

export const ackReplies = (link: HostLink, ids: number[]) =>
  hostApi(link, HELD_REPLIES, { body: { ids }, timeout: TIMEOUT.replies });
