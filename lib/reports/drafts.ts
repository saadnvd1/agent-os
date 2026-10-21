// The drafted next prompt: approve (one click), edit-and-approve, or dismiss.
// A task with an analyst pairing uses the analyst's own recommendation, so
// there is one draft system; a plain task's draft lives on its report row.

import { db, type Session } from "../db";
import { deliver } from "../bus";
import {
  dismissRecommendation,
  forwardToCoder,
  sendRecommendation,
} from "../analyst/forward";
import { statusDetector } from "../status-detector";
import { claimDraft, getReport, reopenDraft, setDraftText } from "./store";

export class DraftError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 409
  ) {
    super(message);
  }
}

export const draftItemId = (reportId: number) =>
  `user-report-draft-${reportId}`;

export async function approveDraft(
  sessionId: string,
  input: {
    source: "report" | "analyst";
    id: string;
    linkId?: string;
    text?: string;
  }
): Promise<void> {
  if (input.source === "analyst") {
    if (!input.linkId) throw new DraftError("Missing pairing", 400);
    await sendRecommendation(input.linkId, input.id, input.text);
    return;
  }
  const reportId = Number(input.id);
  const report = getReport(reportId);
  if (!report || report.sessionId !== sessionId || !report.draft)
    throw new DraftError("No such draft", 404);
  const text = (input.text ?? report.draft.text).trim();
  if (!text) throw new DraftError("There is no prompt to send", 400);
  if (!claimDraft(reportId, "sent"))
    throw new DraftError(`This draft was already ${report.draft.status}`);
  if (input.text && text !== report.draft.text)
    setDraftText(reportId, text, "sent");
  try {
    const session = db
      .prepare(`SELECT * FROM session_rows WHERE id = ?`)
      .get(sessionId) as Session | undefined;
    if (!session) throw new DraftError("No such task", 404);
    if (session.view === "chat")
      await forwardToCoder(sessionId, {
        text,
        id: draftItemId(reportId),
        label: "Analyst",
      });
    else {
      await statusDetector.refreshCache();
      const delivery = await deliver(session, text, { name: "Analyst" });
      if (delivery.state === "failed") throw new Error(delivery.why);
    }
  } catch (error) {
    reopenDraft(reportId);
    throw error;
  }
}

export function dismissDraft(
  sessionId: string,
  input: { source: "report" | "analyst"; id: string; linkId?: string }
): void {
  if (input.source === "analyst") {
    if (!input.linkId) throw new DraftError("Missing pairing", 400);
    dismissRecommendation(input.linkId, input.id);
    return;
  }
  const report = getReport(Number(input.id));
  if (!report || report.sessionId !== sessionId || !report.draft)
    throw new DraftError("No such draft", 404);
  if (!claimDraft(report.id, "dismissed"))
    throw new DraftError(`This draft was already ${report.draft.status}`);
}
