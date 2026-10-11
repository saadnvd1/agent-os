// CI: fail a pull request whose body has no Code review section for its
// head commit (the same rule the orchestrator's sign_off and stacks' land
// apply). Reads PR_BODY and HEAD_SHA from the environment.
import { codeReviewRefusal, parseCodeReview } from "../lib/tasks/code-review";

// A head AgentOS rebased itself is covered by the review of the head it
// rebased, as its gates allow.
const section = parseCodeReview(process.env.PR_BODY ?? "");
const refusal = codeReviewRefusal(
  section,
  process.env.HEAD_SHA || undefined,
  section?.restacked
);
if (refusal) {
  console.error(`✗ ${refusal}.`);
  console.error(
    "Run /do-code-review on the branch, then put its section in the PR body:\n\n## Code review\nReviewed: <head sha>\nAgents: ...\nFixed: ...\nDeferred: ..."
  );
  process.exit(1);
}
console.log(`✓ the Code review section covers ${process.env.HEAD_SHA}`);
