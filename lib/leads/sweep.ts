// The chief of staff's daily sweep: an ordinary message schedule to the
// chief, made with it by "Add leads", which the owner can move, pause or
// remove like any other. Its turn starts from a schedule, not the owner, so
// the chief's acting tools refuse in it (./chief.ts): it reads and asks.
// A slot is skipped while the usage window is about to run out.

import { db } from "../db";
import { readUsage, windowRefusal } from "../orchestrator/usage";
import {
  createSchedule,
  listSchedules,
  type Schedule,
} from "../schedules/store";
import { isChiefRole } from "./roles";

export const SWEEP_NAME = "Chief of staff daily sweep";
export const SWEEP_CRON = "0 8 * * *";

export const SWEEP_PROMPT = `Your daily sweep. Read the workspace with company (open a thread only when its header says it needs you), and look for:
- direction two leads read differently, or work that contradicts a pin;
- two leads on the same work, or work nobody owns;
- asks that have waited more than a day, and threads stuck on a reply.
This turn only reads and raises asks: don't start, stop, send or message anyone. For each thing that needs a decision, raise one ask with ask_owner, saying which leads and pins it involves. Then reply with a short summary: what changed since yesterday, and what waits on the owner. If nothing needs anyone, say so in one line.`;

export function chiefSweep(workspaceId: string, chiefId: string) {
  return (
    listSchedules(workspaceId).find(
      (s) => s.kind === "message" && s.target_session_id === chiefId
    ) ?? null
  );
}

export function addChiefSweep(workspaceId: string, chiefId: string): Schedule {
  return (
    chiefSweep(workspaceId, chiefId) ??
    createSchedule({
      workspaceId,
      name: SWEEP_NAME,
      cron: SWEEP_CRON,
      prompt: SWEEP_PROMPT,
      kind: "message",
      targetSessionId: chiefId,
    })
  );
}

const targetsChief = (s: Schedule): boolean => {
  if (s.kind !== "message" || !s.target_session_id) return false;
  const row = db
    .prepare(`SELECT role FROM sessions WHERE id = ?`)
    .get(s.target_session_id) as { role: string | null } | undefined;
  return isChiefRole(row?.role);
};

// Why a scheduled turn of a chief skips this slot, or null. Only a window
// that is known to be running out skips: with no reading, it runs.
export function chiefSlotSkip(s: Schedule): string | null {
  if (!targetsChief(s)) return null;
  const usage = readUsage();
  if (!usage || "unknown" in usage) return null;
  const why = windowRefusal(usage);
  return why ? `skipped to save the usage window: ${why}` : null;
}
