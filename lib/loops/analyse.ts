import type { RunUsage } from "../usage/check-runs";
import { runClaude, type ClaudeRunner } from "../orchestrator/claude-cli";
import { checkout, removeCheckout } from "../orchestrator/repo";
import {
  ANALYSIS_SCHEMA,
  ANALYST_SYSTEM,
  analystPrompt,
  toAnalysis,
  type AnalystInput,
} from "./analyst-prompt";
import type { Analysis } from "./types";

// The model role the analyst runs on (BR02-17's "analyze"); the role's
// model is Settings' and the workspace's to pick, never the task's.
export const ANALYST_ROLE = "analyze" as const;

// One stateless run on a throwaway checkout of the snapshot: Read, Grep and
// Glob inside it, nothing else. Its cost comes back with the analysis.
export async function analyse(input: {
  repo: string;
  sha: string;
  workspaceId: string | null;
  prompt: AnalystInput;
  claude?: ClaudeRunner;
}): Promise<{ analysis: Analysis; costUsd: number }> {
  const dir = await checkout(input.repo, input.sha);
  let cost = 0;
  try {
    const answer = await (input.claude ?? runClaude)({
      cwd: dir,
      system: ANALYST_SYSTEM,
      prompt: analystPrompt(input.prompt),
      schema: ANALYSIS_SCHEMA,
      tools: ["Read", "Grep", "Glob"],
      allow: [`Read(/${dir}/**)`, `Grep(/${dir}/**)`, `Glob(/${dir}/**)`],
      onUsage: (u: RunUsage) => {
        cost += u.costUsd;
      },
      role: ANALYST_ROLE,
      workspaceId: input.workspaceId,
    });
    return { analysis: toAnalysis(answer), costUsd: cost };
  } finally {
    await removeCheckout(input.repo, dir);
  }
}
