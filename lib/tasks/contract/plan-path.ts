import path from "path";
import { plansDir } from "../../plans/features";

// A plan written on a linked machine, copied here so this machine's
// orchestrator and plan view can read it (contract/plan.ts).
export const remotePlanPath = (sessionId: string) =>
  path.join(plansDir(), "remote", `${sessionId}.md`);
