/**
 * Watches each workspace that has an orchestrator and wakes it with events:
 * every few seconds it delivers what's queued, and less often it diffs what
 * the server already computes (sessions, tasks, stacks) for new events.
 */

import { chatState, sendChat } from "../chat/runner";
import { getWorkspace } from "../workspaces";
import { conditionsFor, stackFacts } from "./conditions";
import { deliverEvents } from "./deliver";
import { recordConditions } from "./events";
import { sessionFacts } from "./facts";
import { listOrchestrators } from "./home";

const DELIVER_EVERY_MS = 5000;
const DIFF_EVERY = 3; // ticks: a diff every 15s

let timer: NodeJS.Timeout | null = null;
let ticks = 0;
let busy = false;

export async function diffWorkspace(workspaceId: string): Promise<string[]> {
  const facts = await sessionFacts(workspaceId);
  return recordConditions(
    workspaceId,
    conditionsFor(facts, stackFacts(workspaceId))
  );
}

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  const diff = ticks++ % DIFF_EVERY === 0;
  try {
    for (const orch of listOrchestrators()) {
      const workspaceId = orch.workspace_id;
      if (!workspaceId || !getWorkspace(workspaceId)) continue;
      try {
        if (diff) await diffWorkspace(workspaceId);
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
