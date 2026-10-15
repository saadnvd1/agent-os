// Switching No approvals mode: the one place that turns it on or off and
// brings what already exists in line with it.

import { db } from "../db";
import { isRemoteHost } from "../hosts";
import { reapplyChatModes } from "../chat/settings";
import { approvePlanNow } from "../models/plan-step";
import { autoApproveAsk, type AskRow } from "../orchestrator/asks";
import { addNote } from "../orchestrator/notes";
import { listOrchestrators } from "../orchestrator/home";
import {
  noApprovalsOn,
  recordAutoApproval,
  setNoApprovals,
} from "./no-approvals";

// Everything already waiting when the mode goes on is approved: open asks,
// plan-only tasks at their plan, tool cards in live chats.
async function sweep(): Promise<void> {
  const asks = db
    .prepare(`SELECT * FROM orchestrator_asks WHERE status = 'open'`)
    .all() as AskRow[];
  for (const ask of asks) {
    try {
      autoApproveAsk(ask.workspace_id, ask);
    } catch (e) {
      console.error(`auto-approving ask ${ask.id} failed:`, e);
    }
  }
  const plans = db
    .prepare(
      `SELECT id, host_id, plan_waits_for_caller FROM sessions WHERE plan_phase = 'awaiting' AND task_status = 'running'`
    )
    .all() as {
    id: string;
    host_id: string;
    plan_waits_for_caller: number | null;
  }[];
  for (const p of plans) {
    // A plan placed here by another machine is that machine's to decide.
    if (p.plan_waits_for_caller && !isRemoteHost(p.host_id)) continue;
    try {
      await approvePlanNow(p.id, undefined, "no-approvals");
    } catch (e) {
      console.error(`auto-approving plan of ${p.id} failed:`, e);
    }
  }
}

export async function switchNoApprovals(on: boolean): Promise<void> {
  if (on === noApprovalsOn()) return;
  setNoApprovals(on);
  recordAutoApproval({
    source: "mode",
    subject: on
      ? "No approvals mode turned on"
      : "No approvals mode turned off",
  });
  for (const o of listOrchestrators()) {
    if (!o.workspace_id) continue;
    addNote(
      o.workspace_id,
      on
        ? "No approvals mode is on: every ask is approved as it's raised, and agents run without permission prompts."
        : "No approvals mode is off: asks wait for Saad again.",
      "ask"
    );
  }
  if (on) await sweep();
  reapplyChatModes();
}
