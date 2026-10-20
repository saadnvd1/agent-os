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

## Queueing a start after a claim

`start_task` (the orchestrator's, never a person's start) checks the repo's live
claims first (`lib/claims/startCheck.ts`). A **strong** overlap queues the start
after that claim: a local task is waited on as a task, anything else as
`after: "claim:<id>"` (`task_queue.after_claim`, wait code `after_claim`). The
wait ends when the claim is released, merged or expires. The orchestrator gets a
`claim-queued:` event saying what it waits on and the shared files; `start_now`
overrides it. Weaker overlaps are only a heads-up in the result. `now`,
`ignore_claims` or an explicit `after` skip the auto-queue.

## Sessions AgentOS didn't start

A Claude Code session in a plain terminal can claim its repo too, through `aos claim`
against the AgentOS on the same machine (`AGENTOS_URL`):

- `aos claim start "<goal>"` registers a claim, `aos claim goal "<line>"` refines the
  goal, `aos claim touch [--quiet]` renews it, `aos claim end` (or `done`) releases it,
  and `aos claim check` prints the strong overlaps and exits 1 if there are any.
- The CLI runs git in its own folder and posts the remote URL (credentials removed),
  branch and the repo-relative paths of the diff, to `POST /api/claims`. File contents
  are never read and the server runs no git in an unknown folder. The claim id (and
  goal) sit in `<git dir>/agentos-claim`, outside the work tree.
- Source `outside`, id `o-<uuid>`. It lives `OUTSIDE_TTL_MS` (30 minutes) from its last
  touch, then travels to linked machines like any other claim (peers cap it at 15
  minutes and the exchange renews it while it lives). `DELETE /api/claims/:id` only
  ends an `outside` claim of this machine, never a task's or a peer's.
- Overlaps are read by the session itself: `aos claim check`, and the hook prints them
  at `SessionStart`. AgentOS sessions that overlap an outside claim are told as usual,
  but an outside session is never messaged: it has no inbox.
- `aos claim install-hook [--user]` adds `scripts/claim-hook.sh` for `SessionStart`,
  `UserPromptSubmit` and `Stop` to the repo's `.claude/settings.local.json` (or
  `~/.claude/settings.json`), printing what it added. On a prompt or stop the hook
  touches at most once a minute, in the background, with a short timeout. It always
  exits 0 and prints nothing when AgentOS is down. What it prints at `SessionStart` is
  one line per overlap, stripped of control and quote characters and labelled as data.

Not built: claims for sessions found only by tmux discovery, and a PC with no AgentOS
(it needs a claims-only token).
