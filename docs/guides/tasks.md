---
title: Tasks
description: Hand work to an agent that ends in a pull request: queued tasks, sign-off and merge, stacked cards, and plans split into pieces.
order: 5
---

# Tasks

A task gets its own git worktree, branch and ports, opens as a chat, runs
the project's code review before it opens its PR, and waits for your
sign-off. A workspace's running task limit (Settings → Workspaces) caps how many run at once; the rest
wait under **Queued** with their place in line and start on their own, and
`aos task --after` holds one until another finishes.

![A task's chat: the edit, the tests, the code review and the PR it opened](https://raw.githubusercontent.com/saadnvd1/agent-os/main/screenshots/task-chat.png)

![Two queued tasks in the sidebar, one in line and one waiting on another task, with its menu open](https://raw.githubusercontent.com/saadnvd1/agent-os/main/screenshots/queued.png)

Hand off work and keep going. A task is a draft with **Open a PR when
done** turned on (**New task** in ⌘K, the sidebar's New menu or the Tasks
panel opens one). AgentOS creates a git worktree and branch, starts Claude there in tmux
with a brief to finish by pushing and opening a pull request, and tracks it:
Working, Needs input, Blocked, Ready for review, Checks failing or Agent
exited. **Sign off & merge** merges the PR (refused while CI is failing
or pending), then removes the session, worktree and branches. **Drop** closes
the PR and removes everything. Agents never merge their own work.

**Merging settings.** How a PR merges (sign-off, Done, Land and the
orchestrator's external PRs alike) and what's cleaned up after it are set in
**Settings → Merging** (or ⌘K → Merge settings) for every project,
and overridden per project in its **Project Settings → Merging** or in its
`agentos.json`:

```json
{
  "merge": {
    "method": "rebase",
    "delete_remote_branch": true,
    "delete_worktree": false
  }
}
```

`method` is `squash` (the default), `merge` (a merge commit) or `rebase`.
GitHub enforces the repository's allowed methods: if it refuses the one set,
the merge fails with a message naming the method and the repository setting
to turn on (Settings → General → Pull Requests), and AgentOS never falls back
to another method. The project's settings show a method its repository has
turned off. `delete_remote_branch` and `delete_worktree` (both on by default)
delete the branch on origin and the local worktree with its branch after a
merge. With either on, `main`, `master` and `HEAD` are never deleted, nor a
branch a stacked task still targets, nor a worktree holding uncommitted work
or commits the merge didn't include. The most specific setting wins: the
project's, then `agentos.json`, then the global one.

**Queued tasks.** A workspace can limit how many tasks run at once (none by
default; set it in **Settings → Workspaces**, or `PATCH /api/workspaces/<id>` with `{"maxRunningTasks": 3}`, or
`null` for no limit). A task started over the limit is queued, with no
worktree or agent yet, and starts by itself in line order when one finishes
(merged, dropped or done). `aos task --after <task|any>` (and the
orchestrator's `start_task` with `after`) holds a task until a named task
finishes, or until any task still working now does (a running task whose PR
was closed or merged doesn't count; with none, it starts at once). The
orchestrator's `drop` removes a queued task by its id. Pause stops automatic starts,
and the orchestrator's brakes still apply when its queued tasks start. A task runs on Claude Code unless
`POST /api/tasks` names another `agent` (`"copilot"`): that one runs as a chat on
this machine, with no plan-first step or role models, and is never picked for
you. The
line is kept in the database across restarts (`GET /api/tasks/queue`; start
now, move up or down, or remove with `/api/tasks/queue/<id>`). The sidebar
shows them under **Queued** with their place in line or what they wait on,
and the same actions in each row's menu; a row becomes the task's own row
when it starts. Why it works
this way: [docs/decisions/2026-10-10-queued-tasks.md](https://github.com/saadnvd1/agent-os/blob/main/docs/decisions/2026-10-10-queued-tasks.md).

A paired device's token can run the building loop through read-only routes:
`GET /api/start-options?projectId=` (agents and models, the models a task can
run on, machines, branches, whether a task plans first, in one request),
`GET /api/tasks/<id>/diff` (the task's whole change, base to head: a file list,
then `?file=<path>` for one file's patch; capped, with `truncated` when a cap
is hit; read from the worktree, else the PR), and `GET /api/tasks/<id>/checks`
(the PR head's checks, the tail of a failing job's log, and the review gate's
verdict). A task's `plan` in `GET /api/tasks` carries `status` (`writing`,
`ready` or `approved`), a title and capped text. Their shapes are in
`lib/tasks/loop-types.ts`, which has no server imports so a client can share it.

## Stacks

A project whose board is linked to LumifyHub can run the whole board as
**stacked** tasks: **Tasks → From the board → Run as stack** shows the plan
first, then starts it. A card starts as soon as every card it's blocked by has
a PR open (not merged), on top of the card it depends on most: its branch is
cut from that card's pushed branch, and its PR targets it, so each PR shows
only its own commits. At most three run at once without a PR (adjustable).

Merging goes bottom-up. Signing off a card whose parent hasn't merged is
refused; after a parent merges, every card stacked on it (grandchildren
included) is rebased and its PR retargeted, and its agent is told. This works
with every merge method: only the child's own commits are replayed onto the
default branch, whether the parent was squashed, rebased or merged with a
merge commit. **Land**
merges every PR in order after checking all of them are open and green, and
waits for each restacked PR's checks before merging it. A chat card's agent
is stopped between turns before anything merges (Land waits up to 5 minutes
for a running turn, and refuses, naming the card, if it doesn't end), and
what it's sent during the land waits in its queue. A conflict stops on
that card with the exact command to fix it.

## Plans in pieces

A plan ends with a `## Pieces` block, one piece by default. AgentOS accepts
more only for one of four reasons, written on the piece: (a) it spans
repositories, (b) one part must be live (merged and deployed) before the
other can merge, (c) one part needs you mid-way, (d) one part must be
revertible on its own (a migration that rewrites rows, or an auth change
mixed with other work). Diff size is never a reason. A piece without a
standing reason is folded into the one before it, and a repository with no
deploy check can't claim (b); this is a deterministic check, not the model's
word.

A one-piece plan behaves as always. With several, piece 1 continues in the
planning task with only its slice, and the rest wait as rows (no worktree,
port or queue slot) until what they wait on has merged or deployed, then start
as tasks through the usual brakes and queue. A plan waiting for approval
shows its pieces: **Merge into ①** or **Drop** a piece (undoable until you
approve), **Approve with note…**, or **Reject**. Each piece's review judges
its slice; the last also checks the whole plan was built. **Tasks** shows
the feature's pieces and what each waits on, with **Release anyway** for one
held by a dropped or failed predecessor. A plan-only task that reaches
approval sends a "Plan ready: name, N pieces" push, and a finished feature
sends one "Feature merged" push naming it.
