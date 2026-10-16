import { sendMessage } from "@/lib/bus";
import { registry } from "@/lib/chat/registry";
import { chatNeed } from "@/lib/needs-you";
import { queueEventOnce } from "@/lib/orchestrator/events";
import { listOrchestrators } from "@/lib/orchestrator/home";
import type { HealthConfig } from "../config";
import { raiseAlerts, type AlertDeps } from "./raiseAlerts";
import { sendFixNotes, type NoteDeps } from "./sendFixNotes";

export interface EnvDeps {
  notes: NoteDeps;
  alerts: AlertDeps;
}

export const realEnv: EnvDeps = {
  notes: {
    send: async (sessionId, body) => {
      await sendMessage({
        fromId: null,
        to: sessionId,
        body,
        fromLabel: "AgentOS health",
        origin: { kind: "system", label: "Environment", body },
      });
    },
    // Open asks don't count: an orchestrator with some still hears it.
    blocked: (id, role) =>
      chatNeed({ id, role }, registry.live.get(id)?.state ?? null, 0) !== null,
  },
  alerts: {
    queue: queueEventOnce,
    workspaces: () =>
      listOrchestrators()
        .filter((o) => !o.archived_at && o.workspace_id)
        .map((o) => o.workspace_id as string),
  },
};

export async function envTick(
  now: number,
  c: HealthConfig,
  deps: EnvDeps = realEnv
): Promise<void> {
  raiseAlerts(now, c, deps.alerts);
  await sendFixNotes(now, deps.notes);
}
