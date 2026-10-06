/**
 * Watches each workspace that has an orchestrator and wakes it with events:
 * every few seconds it delivers what's ready, and less often it diffs what
 * the server already computes (sessions, tasks, stacks) for new events:
 * every 15s while anything in the workspace is working, every 60s when not.
 */

import { chatState, sendChat } from "../chat/runner";
import { getWorkspace } from "../workspaces";
import { conditionsFor, recentlyMessaged, stackFacts } from "./conditions";
import { deliverEvents } from "./deliver";
import { recordConditions } from "./events";
import { sessionFacts } from "./facts";
import { listOrchestrators } from "./home";
import { BRAKE_SUBJECT, openAsks } from "./asks";
import { resolveFinishedTaskAsks } from "./ask-approvals";
import { brakesOn, liftBrake } from "./brakes";

// Asks that stopped needing Saad: a held task merged or dropped, brakes
// that lifted with nothing trying to start.
async function settleAsks(workspaceId: string): Promise<void> {
  resolveFinishedTaskAsks(workspaceId);
  const brake = openAsks(workspaceId).some((a) => a.subject === BRAKE_SUBJECT);
  if (brake && !(await brakesOn(workspaceId)).length) liftBrake(workspaceId);
}

const DELIVER_EVERY_MS = 5000;
export const DIFF_BUSY_MS = 15 * 1000;
export const DIFF_IDLE_MS = 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let busy = false;
const nextDiff = new Map<string, number>();

// Returns when to look again: soon while anything works.
export async function diffWorkspace(
  workspaceId: string,
  orchestratorId: string,
  now = Date.now()
): Promise<number> {
  const facts = await sessionFacts(workspaceId);
  await settleAsks(workspaceId);
  const stacks = stackFacts(workspaceId);
  const subjects = [
    ...facts.map((f) => f.id),
    ...stacks.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]),
  ];
  recordConditions(
    workspaceId,
    conditionsFor(facts, stacks, now, recentlyMessaged(orchestratorId, now)),
    subjects,
    now
  );
  const working =
    facts.some((f) => f.status === "running") ||
    stacks.some((s) => s.status === "running" || s.status === "landing");
  return now + (working ? DIFF_BUSY_MS : DIFF_IDLE_MS);
}

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (const orch of listOrchestrators()) {
      const workspaceId = orch.workspace_id;
      if (!workspaceId || !getWorkspace(workspaceId)) continue;
      try {
        if ((nextDiff.get(workspaceId) ?? 0) <= Date.now())
          nextDiff.set(workspaceId, await diffWorkspace(workspaceId, orch.id));
        await deliverEvents({
          workspaceId,
          orchestratorId: orch.id,
          turn: chatState(orch.id),
          send: sendChat,
        });
      } catch (error) {
        console.error(`Orchestrator events for ${workspaceId}:`, error);
      }
    }
  } finally {
    busy = false;
  }
}

export function startOrchestratorWatcher(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), DELIVER_EVERY_MS);
  timer.unref();
  void tick();
}
