/**
 * Moving a session to another model without losing its conversation or
 * worktree. On the same provider a live conversation switches in place;
 * across providers the endpoint and key are in the agent's environment, so
 * its worker goes and the next message starts one that resumes the same
 * conversation on the new provider.
 */

import { db, type Session } from "../db";
import { getSession, registry } from "../chat/registry";
import { emitCapabilities, setChatModel } from "../chat/settings";
import {
  providerFor,
  sessionRole,
  setSessionModel,
  type RoutedModel,
} from "./resolve";
import { PI } from "./providers";
import { isAgentRole } from "./agent-roles";
import { assertCanCallTools } from "./agent-binding";
import { ANTHROPIC, formatModelRef, parseModelRef } from "./roles";

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

// Moves a session to "provider/model" (or "pi/<provider>/<model>" for a Pi
// session), keeping its conversation. Only this session's row changes: no
// other session's model and no role setting.
export async function switchSessionModelRef(
  session: Session,
  ref: string
): Promise<void> {
  const parsed = parseModelRef(ref);
  if (isAgentRole(session.agent_role))
    await assertCanCallTools(session.agent_role, formatModelRef(parsed));
  if (session.agent_type === "pi") {
    if (parsed.provider !== PI)
      throw new Error(
        "A Pi session runs on a Pi model (pi/<provider>/<model>)"
      );
    await setChatModel(session.id, parsed.model);
    return;
  }
  if (parsed.provider === PI)
    throw new Error("Only a Pi session can move to a Pi model");
  await switchSessionModel(session.id, {
    role: sessionRole(session),
    ref: formatModelRef(parsed),
    provider: providerFor(parsed.provider),
    model: parsed.model,
    source: "task",
  });
}

// A pick in a chat's model list. A full ref ("provider/model") moves the
// session across providers; a bare model on a session routed to another
// provider goes back to Anthropic, so "opus" is never asked of another
// provider's endpoint. Anything else is the agent's own model name.
export async function setComposerModel(
  sessionId: string,
  value: string
): Promise<void> {
  const session = db
    .prepare(`SELECT * FROM session_rows WHERE id = ?`)
    .get(sessionId) as Session | undefined;
  const model = value.trim();
  if (!session || !model) return;
  const claude = session.agent_type === "claude";
  const ref = claude
    ? model.includes("/")
      ? model
      : session.model_provider
        ? `${ANTHROPIC}/${model}`
        : null
    : session.agent_type === "pi" && model.startsWith(`${PI}/`)
      ? model
      : null;
  if (!ref) return setChatModel(sessionId, model);
  await switchSessionModelRef(session, ref);
  // A move across providers stops the worker, which tells nobody.
  emitCapabilities(getSession(sessionId));
}
