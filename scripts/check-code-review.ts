// CI: fail a pull request whose body has no Code review section for its
// head commit (the same rule the orchestrator's sign_off and stacks' land
// apply). Reads PR_BODY and HEAD_SHA from the environment. Fails closed: an
// unset or blank body, a head that isn't a full sha (jq prints "null" for a
// missing field) or any throw exits 1; the only exit 0 is after the check.
import { codeReviewRefusal, parseCodeReview } from "../lib/tasks/code-review";

const FULL_SHA = /^[0-9a-f]{40}$/i;

function refusal(): string | null {
  const body = process.env.PR_BODY;
  const head = process.env.HEAD_SHA?.trim();
  if (!body?.trim()) return "the PR body is empty or couldn't be read";
  if (!head || !FULL_SHA.test(head))
    return `the PR's head commit is unknown (HEAD_SHA=${JSON.stringify(head ?? null)})`;
  return codeReviewRefusal(parseCodeReview(body), head);
}

try {
  const why = refusal();
  if (why) {
    console.error(`✗ ${why}.`);
    console.error(
      "Run /do-code-review on the branch, then put its section in the PR body:\n\n## Code review\nReviewed: <head sha>\nAgents: ...\nFixed: ...\nDeferred: ..."
    );
    process.exit(1);
  }
  console.log(`✓ the Code review section covers ${process.env.HEAD_SHA}`);
  process.exit(0);
} catch (err) {
  console.error(`✗ the code review check failed: ${err}`);
  process.exit(1);
}
