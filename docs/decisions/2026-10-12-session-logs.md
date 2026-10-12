# Session logs for merged tasks

**Decision.** When a task merges, write a log of it from data AgentOS already stores, with a fixed template and no
model. Keep it in `session_logs` (never deleted) and copy it to a markdown file outside the repository.

**Why.** What a task did, how its review and CI went and what it cost is spread over a dozen tables and gone from
the worktree once it is cleaned up. The one thing only the worktree held, the plan file, has to be read before
cleanup. The requirement is that it runs on every task, so it can't cost tokens.

**Choices.**

- One entry point, `captureMergedTask`, called from every place a task becomes merged (sign-off, Done, a merge
  seen on GitHub; stack landings and the orchestrator's `sign_off` and `done` go through those). It reads the plan
  file synchronously and does the rest after the caller returns. It is idempotent: an in-flight set, then the
  primary key.
- It never throws into the merge; a failure is logged and the next call retries.
- Untrusted text goes in fences longer than anything inside it, or in code spans, and is redacted.
- The file is a copy. If it can't be written the database row still stands. A project's folder override that
  points into its own repository is refused when saved and ignored when writing.
- The merge commit comes from `gh pr view` after the fact, because the head AgentOS merged is not the commit a
  squash makes. If GitHub can't be read the log shows the PR head and says so.

**Not covered.** The timeline is what is stored: a CI pass is only known for the head that merged, rebases show the
last one, and a gate failure that was cleared by a later commit still shows. Terminal tasks keep no conversation, so
they have no outcome.
