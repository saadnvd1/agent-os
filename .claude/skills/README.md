# Skills and review agents

| Skill            | Use                                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `do-code-review` | Mandatory before every pull request: review a branch or PR with the agents in `.claude/agents/`, in parallel, verify every finding with `review-finding-verifier`, fix Blocking and High, and write the PR body's "Code review" section |
| `debugging`      | Debug and troubleshoot issues                                                                                                                                                                                                           |

| Agent                        | Reviews                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review-security`            | The gate, loopback/tailnet trust, forwarding headers, Host/Origin, upgrades, pairing and passkeys, secrets, injection, traversal, untrusted text, client-triggered crashes |
| `review-orchestrator-safety` | Gates failing closed, merges pinned to the judged sha, workspace scoping, brakes, asks, the reviewer's isolation, approvals needing a human                                |
| `review-durability`          | The chat worker protocol, restart and reattach, idempotent sends, claims before side effects, migrations, the event loop                                                   |
| `review-frontend`            | Phone first and 44px targets, light and dark, React Query, no AI-slop visuals, accessibility                                                                               |
| `review-test-quality`        | Missing tests, tests that pass for the wrong reason, NODE_ENV and machine-specific traps                                                                                   |
| `review-spec-compliance`     | Did it do what the task, card or PR asked, and nothing else                                                                                                                |
| `review-finding-verifier`    | Confirms or rejects every finding with evidence                                                                                                                            |

The rule that every PR carries a "Code review" section for its head commit is stated in four places that must stay in sync: the task brief (`lib/tasks/brief.ts`), the orchestrator's brief (`lib/orchestrator/brief.ts`), the do-code-review skill, and the parser that enforces it (`lib/tasks/code-review.ts`, used by `sign_off`, stacks' `land` and `.github/workflows/code-review.yml`).

When an invariant changes (a new trust source, a new gate, a new sensitive path), update the code, the agent that reviews it, and the "invariants, in brief" list in the do-code-review skill together. When a review misses a real bug, add the pattern to the agent that should have caught it.
