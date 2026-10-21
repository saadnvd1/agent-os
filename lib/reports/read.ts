// The report a client sees: the stored one, with the current draft laid over
// it and its staleness against the task's head.

import { isFinished } from "../tasks/state";
import { analystDraft } from "./evidence/gather";
import { isGenerating } from "./generate";
import { modeOf } from "./mode";
import { latestReport } from "./store";
import type { ReportResponse } from "./types";

export function readReport(sessionId: string): ReportResponse {
  const mode = modeOf(sessionId);
  const report = latestReport(sessionId);
  if (report) {
    const live = mode.mode !== "manual" && !isFinished(report.state);
    // The analyst's open recommendation is the draft when the task has one.
    const own = live ? analystDraft(sessionId) : null;
    report.draft = !live
      ? null
      : (own ??
        (report.draft?.status === "pending" || report.draft?.status === "sent"
          ? report.draft
          : null));
  }
  return { report, generating: isGenerating(sessionId), mode };
}
