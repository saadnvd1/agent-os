import { deliver } from "../bus";
import { forwardToCoder } from "../analyst/forward";
import {
  insertRecommendation,
  decideRecommendation,
  liveLinkFor,
} from "../analyst/store";
import type { Session } from "../db";
import { statusDetector } from "../status-detector";
import type { Analysis } from "./types";

export const LOOP_LABEL = "Analyst loop";

// The id the chat keeps the message by, so a resend after a restart is a
// no-op.
export const instructionId = (loopId: string, n: number) =>
  `loop-${loopId}-${n}`;

// The instruction as the coder reads it: the instruction, then which
// criteria are still open.
export function instructionText(
  instruction: string,
  open: { id: number; text: string }[]
): string {
  const list = open.length
    ? `\n\nStill open (acceptance criteria):\n${open.map((c) => `${c.id}. ${c.text}`).join("\n")}`
    : "";
  return `${instruction.trim()}${list}`;
}

// Hands the instruction to the task's agent: a chat's next prompt (the
// analyst-forward path, by id) or typed into a terminal. Throws when it
// could not be delivered. Returns how it went.
export async function sendInstruction(
  task: Session,
  loopId: string,
  n: number,
  text: string
): Promise<string> {
  if (task.view === "chat") {
    await forwardToCoder(task.id, {
      text,
      id: instructionId(loopId, n),
      label: LOOP_LABEL,
    });
    return "sent";
  }
  await statusDetector.refreshCache();
  const delivery = await deliver(task, text, { name: LOOP_LABEL });
  if (delivery.state === "failed") throw new Error(delivery.why);
  return delivery.state;
}

// A paired analyst's split view shows the same history: the instruction as
// a sent card. Best effort; the loop never depends on it.
export function mirrorToPairing(
  taskId: string,
  loopId: string,
  n: number,
  text: string,
  analysis: Analysis | null
): void {
  try {
    const link = liveLinkFor(taskId);
    if (link?.coderSessionId !== taskId) return;
    const itemId = instructionId(loopId, n);
    const rec = insertRecommendation({
      linkId: link.id,
      analystItemId: itemId,
      coderThrough: null,
      signals: null,
      verdict: "continue",
      summary: analysis?.summary ?? "",
      issues: [],
      prompt: text,
      state: "open",
    });
    if (rec)
      decideRecommendation(rec.id, "sent", { text, itemId, edited: false });
  } catch {
    // The loop goes on.
  }
}
