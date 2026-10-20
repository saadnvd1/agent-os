# Work claims

A registry of what each live session is working on, shared between linked
machines, so two agents don't build the same thing in the same repository
without knowing.

A claim is: repo key (the normalised remote URL, `host/owner/repo`), branch,
a one-line goal (the session or task name, never the prompt), the repo-relative
paths of its diff so far, the PR link, and the machine's name. No code, diffs,
prompts or absolute paths leave the machine, and only to machines you linked.

- Each server owns the claims of its own sessions (`lib/claims/collectLocal.ts`).
- Every minute a server sends its claims to each linked machine and gets theirs
  back in the same request (`POST /api/claims/exchange`,
  `lib/claims/exchange.ts`), so it works when only one side can reach the other.
  A machine also relays what it learned, up to two hops, never back to its
  source.
- Times cross the wire as durations (`ttl_s`, `age_s`), so clock skew doesn't
  matter. A local claim lives 10 minutes and is renewed each sync; a peer can
  give a claim at most 15 minutes. A released claim is kept 15 minutes as a
  tombstone so the release (merged, done) reaches the peers.
- Overlap (`lib/claims/overlap.ts`): the same non-default branch; shared files
  (lockfiles, changelogs and generated indexes ignored, files many claims touch
  discounted); a similar goal, which alone is only weak.
- Any failure means no claims: it never blocks a start or a session. Turn it off
  with the setting `claims.share` = `off`.

Read it: `aos claims [--all] [--json]`, `GET /api/claims`, and the orchestrator's
`sessions` tool, which lists what other machines claim in the workspace's repos.
