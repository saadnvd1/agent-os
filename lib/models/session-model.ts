/**
 * Moving a session to another model without losing its conversation or
 * worktree. On the same provider a live conversation switches in place;
 * across providers the endpoint and key are in the agent's environment, so
 * its worker goes and the next message starts one that resumes the same
 * conversation on the new provider.
 */

import { db, type Session } from "../db";
import { registry } from "../chat/registry";
import { setChatModel } from "../chat/settings";
import { setSessionModel, type RoutedModel } from "./resolve";
import { ANTHROPIC } from "./roles";

export async function switchSessionModel(
  sessionId: string,
  routed: RoutedModel
): Promise<void> {
  const before = db
    .prepare(`SELECT model_provider FROM sessions WHERE id = ?`)
    .get(sessionId) as Pick<Session, "model_provider"> | undefined;
  setSessionModel(sessionId, routed);
  await applySessionModel(
    sessionId,
    before?.model_provider ?? ANTHROPIC,
    routed
  );
}

// What's live catches up with the row: the model now, or a fresh worker.
export async function applySessionModel(
  sessionId: string,
  fromProvider: string,
  routed: RoutedModel
): Promise<void> {
  if (fromProvider === routed.provider.id)
    return setChatModel(sessionId, routed.model);
  if (registry.live.has(sessionId))
    (await import("../chat/runner")).stopChat(sessionId);
}
