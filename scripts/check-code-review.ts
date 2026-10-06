// CI: fail a pull request whose body has no Code review section for its
// head commit (the same rule the orchestrator's sign_off and stacks' land
// apply). Reads PR_BODY and HEAD_SHA from the environment.
import { codeReviewRefusal, parseCodeReview } from "../lib/tasks/code-review";

const refusal = codeReviewRefusal(
  parseCodeReview(process.env.PR_BODY ?? ""),
  process.env.HEAD_SHA || undefined
);
if (refusal) {
  console.error(`✗ ${refusal}.`);
  console.error(
    "Run /do-code-review on the branch, then put its section in the PR body:\n\n## Code review\nReviewed: <head sha>\nAgents: ...\nFixed: ...\nDeferred: ..."
  );
  process.exit(1);
}
console.log(`✓ the Code review section covers ${process.env.HEAD_SHA}`);
