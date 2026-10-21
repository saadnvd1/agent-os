// How the developer-analyst loop meets the reports: a loop makes its task
// Autonomous, every stop hands it back to Assisted with the instruction that
// wasn't sent kept as a pending draft, and each settled cycle asks for a
// report.

import { setLoopHooks } from "../loops/hooks";
import { setTaskEndHook } from "./end-hook";
import { generateReport, requestReport } from "./generate";
import { setTaskMode } from "./mode";
import { setDraftText } from "./store";

let installed = false;

export function installReportHooks(): void {
  if (installed) return;
  installed = true;
  setTaskEndHook((id) => requestReport(id, "end"));
  setLoopHooks({
    onCycleSettled: ({ taskId, analystSummary }) =>
      requestReport(taskId, "cycle", { analystSummary }),
    onStart: (loop) => setTaskMode(loop.sessionId, "autonomous"),
    onStop: (loop, _stop, pending) => {
      setTaskMode(loop.sessionId, "assisted");
      if (!pending) return;
      generateReport(loop.sessionId, "cycle", { force: true })
        .then((r) => setDraftText(r.id, pending, "pending"))
        .catch((error) => console.error("Keeping the loop's draft:", error));
    },
  });
}
