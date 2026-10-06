---
name: do-code-review
description: "Review a branch or PR by dispatching this repo's specialized review agents in parallel, verifying every finding, and reporting what survives by severity. Mandatory before every pull request (the PR body carries its 'Code review' section). Use when: (1) before opening a pull request, (2) the user asks for a PR or code review, (3) after finishing a feature or a large change."
user-invocable: true
argument-hint: "[PR number] (defaults to the current branch vs main)"
---

# Code review

Run the relevant review agents from `.claude/agents/` in parallel, have `review-finding-verifier` check every finding against the code, and report what survives in one list ranked by severity. Then fix, and write the PR body's "Code review" section. Merges are refused without that section for the PR's head commit (`lib/tasks/code-review.ts`, enforced by the orchestrator's `sign_off`, stacks' `land` and the `Code review` CI workflow).

## Process

### 1. Gather the changes and the goal

**Changed files.** With a PR number: `gh pr diff <NUMBER> --name-only` (right for stacked PRs too). Otherwise: `git diff main...HEAD --name-status -M` plus `git status --short --untracked-files=all`, so uncommitted, new and renamed files count. For a stacked task, diff against the branch the PR targets, not main.

**The goal**: what this change was asked to do. Take the first of these that exists, and add the next ones when they add detail:

1. The task prompt this session was started with (an AgentOS task's first message), or the PR body: `gh pr view <NUMBER> --json title,body`
2. The LumifyHub card named in the branch, PR title or prompt (through the `lh` CLI; load the `lh` skill first)
3. The plan in `docs/plans/` the prompt or card points at (local only, gitignored)
4. The commit messages and this conversation

Write it as a short brief: what was asked for, the "done when" list, and the links. With no goal at all, skip `review-spec-compliance` and say so at the top of the report.

### 2. Select agents

| Condition                                                                                                                                                                                                                                                    | Agent                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| A goal was found in step 1                                                                                                                                                                                                                                   | `review-spec-compliance`     |
| `server.ts`, `lib/security/`, `lib/connect/`, `app/api/`, `mcp/`, `bin/`, `scripts/`, `lib/orchestrator/`, `lib/chat/`, `lib/lumifyhub/`, or any file calling `exec`/`spawn`/`execFile`, reading a request, a header, a path or a file, or building a prompt | `review-security`            |
| `lib/orchestrator/`, `lib/tasks/`, `lib/stacks/`, `lib/tasks/brief.ts`, or a route or tool that starts, approves, merges or drops work                                                                                                                       | `review-orchestrator-safety` |
| `lib/chat/`, `lib/db/`, `server.ts`, `lib/stacks/`, `lib/tasks/`, a watcher or background loop, or any `app/api/` route                                                                                                                                      | `review-durability`          |
| `app/` pages and layouts, `components/`, `hooks/`, `data/`, `stores/`, `contexts/`, `styles/` (not `app/api/`)                                                                                                                                               | `review-frontend`            |
| Any `.ts`/`.tsx` implementation or `*.test.ts(x)` file, `vitest.config.mts` or `vitest.setup.ts`                                                                                                                                                             | `review-test-quality`        |

Skip agents whose condition isn't met. When in doubt about `review-security`, run it: it's the one that's expensive to skip.

### 3. Launch in parallel

Send **one message with one Agent call per selected agent** (`subagent_type` = the agent's name). Claude Code registers agent types when a session starts, so in a session started before these files existed (or in a worktree that didn't have them yet), use `subagent_type: "general-purpose"` and begin the prompt with "Read `.claude/agents/<name>.md` and follow it exactly." Each prompt includes the changed-file list (with status letters), the base (`main` or the stack's parent branch), the PR number if any, the goal brief, and: "Follow your review process and output format."

### 4. Verify every finding

Number every finding the agents returned. Send them to `review-finding-verifier` in batches of up to 5, **all batches in one message**. Each finding carries the agent that raised it, file:line, the claim, the failure scenario, and the suggested fix; include the goal brief in batches with spec-compliance findings.

Keep CONFIRMED findings and drop REJECTED ones. Apply a severity change only when the verifier gives evidence for it. Don't argue a rejection back in unless the verifier's evidence is plainly wrong about the code.

### 5. Check the docs (yourself)

`.claude/skills/README.md` says a convention change updates its doc, the skill that writes it and the agent that reviews it together. Check the diff for:

- A rule added or changed in a review agent without the brief, CLAUDE.md "Standards" or README that states it, or the reverse.
- A new user-visible capability, setting, env var or CLI flag missing from `README.md` (or `docs/setup/`).
- A command, route, file or env var the docs name that was renamed or deleted, with the docs left pointing at it.
- UI changes with no "checked at 390 and 1440px, light and dark" line in the PR body (or a line saying why it couldn't be checked).

Report misses as Medium findings, found by "docs check".

### 6. Synthesize

- Deduplicate findings that point at the same code. Keep the most severe framing and list every agent that raised it.
- Assign one severity per finding:
  - **Blocking**: a security hole (auth bypass, injection, traversal, secret exposure, a crash any client can cause), a merge or approval gate that can fail open, data loss or a session lost on restart, broken behaviour, a requirement from the goal not met.
  - **High**: an invariant below weakened without a test; a blocking call in a request handler or the event loop; a migration that edits an applied one; no tests for a new route, gate, tool or parser; a test that passes for the wrong reason; a behaviour change nobody asked for.
  - **Medium**: UI that breaks at phone width or in one theme, missing edge-case tests, docs drift, unrequested changes that don't alter behaviour.
  - **Low**: small cleanups and suggestion-level items.
- Number findings in order, across all sections.

## Output format

```
## Code Review

**Reviewed by:** review-spec-compliance, review-security, review-durability (7 findings, 2 rejected in verification)

### Blocking

**#1: Upgrade path trusts loopback behind a proxy** `server.ts:171`
A tunnelled WebSocket upgrade carries X-Forwarded-For from the relay, but gateUpgrade() is called before proxied() is checked, so a remote client gets loopback trust.
Failure: any client through Connect opens /ws/terminal with no device token.
Fix: run authorize() with proxied(req.headers) before the upgrade, as gateRequest does.
_Found by: review-security_

### High
...
```

- Omit empty sections. No other preamble.
- **Nothing confirmed:** "No issues found." followed by one bullet per agent that ran, saying in a sentence why it flagged nothing (or that its findings were rejected in verification, and why).
- **No agent triggered** (only docs changed): read the diff yourself and flag only obvious problems.

## After the review: fix, then write the section

1. Fix every Blocking and High finding. Fix Medium ones when the fix is small and in scope; otherwise defer them with a reason.
2. Commit, then re-run only the agents that had confirmed findings, on the new diff, and verify again. Stop after two rounds of fixes: list what's still open.
3. The commit you finally reviewed is the PR's head. Put this section at the end of the PR body (`gh pr create --body-file`, or `gh pr edit <n> --body-file` later):

```
## Code review
Reviewed: <full sha of the head commit>
Agents: review-security, review-durability, review-test-quality, review-finding-verifier
Fixed: #1 upgrade trusted loopback behind a proxy (server.ts); #3 migration id collided after rebase
Deferred: #4 composer button is 40px on the sheet (Medium) — the sheet is being replaced in ENG-31
```

Any push of yours after that (a CI fix, a rebase) means a new head: re-run the review on what changed and update the `Reviewed:` line. The CI check reads the PR as it is when it runs, so update the body first and then push, or re-run the check after editing it. A section naming another commit is refused like a missing one. The one exception is a stack restack: when AgentOS rebases your branch onto a merged parent, your review still counts for the head it pushed, until you push again.

## Rules

- Never approve, merge or request changes on GitHub; this is a local report plus the PR body section
- High confidence only. Agents flag clear problems with a failure scenario and a known fix, not speculative improvements
- Report only findings that survived verification, plus the docs check. Don't invent findings, and never write a section for a review that didn't run
- If the user asks for a narrower review (e.g. "just security"), run only those agents, and still verify

## The invariants, in brief

The agents carry the detail; this is the short list. (The orchestrator's own independent reviewer gets the agents' "Rules" sections from the base branch as its checklist, so a rule written there is checked twice.)

- **Access**: every HTTP route and WebSocket upgrade goes through `lib/security/gate.ts`; loopback trust needs a loopback peer, a loopback Host and no proxy header (`proxied()`); tailnet trust needs Tailscale's interface and IPs; device tokens are hashed at rest; actions that mint devices or open the network need local trust; approvals of hard lines need a fresh WebAuthn assertion bound to that ask; any exception in the auth path denies.
- **Processes**: `execFile`/`spawn` with an argument array, never a shell string with interpolated input; `--` before user-supplied git refs or paths; tmux calls pass `-S` and the target explicitly.
- **Secrets**: never in argv, logs, URLs, error text sent to a client, or a file that isn't owner-only (0600 file, 0700 dir).
- **Untrusted text** (other sessions, terminals, CI, cards, PR bodies, web pages) reaches a model only inside `untrusted()` and redacted; it never becomes a command, a path or a tool argument without validation.
- **Gates**: fail closed on missing, stale, unreadable or errored input; merge only with `--match-head-commit` at the sha that was judged; hard lines go to `ask_saad`, never around it; the reviewer subprocess has no shell, no settings from the PR, no MCP.
- **Durability**: a session survives a server restart and reattaches; sends are idempotent by id; migrations are appended with the next id and never edited; nothing synchronous and slow runs in a request handler or the event loop.
- **UI**: phone first (390px), 44px targets, light and dark both checked, no gradients, neon glows or cyan accents.
- **Tests**: test the behaviour, not the mock; pin `NODE_ENV`; no reliance on the author's machine (real `~/.agent-os`, LibreSSL, tmux socket, `limits.json`).
