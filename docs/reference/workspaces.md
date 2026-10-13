# Workspaces

Group projects into workspaces (e.g. Work, Personal) from the workspace
switcher at the top of the sidebar, which also picks the workspace the list
shows and holds the current one's orchestrator, clean-up, Archived and
LumifyHub link. Move a project in from the project filter's menu. Deleting a
workspace keeps its projects.

## Done

**Done** (a session's ⋯ menu; `aos
done`; or the orchestrator's `done` tool) is for finished work, where
**Stop** keeps everything and **Drop** rejects it. A task with an open PR
merges first, only through the orchestrator's gates at the judged commit; a
failing gate refuses with its name and nothing merges. A task already
merged, or a session with no PR, just cleans up. If GitHub can't be read, or
a task that had a PR has none now, done refuses rather than guess.

Cleanup stops the agent and marks the session done: it sits on the sidebar's
Done shelf, not in Archived (`aos archive`, the ⋯ menu's **Archive** and the
orchestrator's `archive` tool put a session away; 30 days in Done does it by
itself). The worktree goes only if
nothing in it would be lost: never with uncommitted changes; after a merge,
only when every commit on it is in the merged PR or on a remote; otherwise
only when its branch has no commits of its own. Anything else is kept and the
reply says why, naming the uncommitted files. Files setup copied in (env
files, agentos.json's `copy`) don't count while they still hold exactly what
was copied; setup records them, hashed from the main checkout, in the
worktree's git directory. Cloned dependencies are gitignored, so never count. A sign-off from Tasks or the orchestrator follows the same
rule. A branch merged on GitHub is deleted on origin when origin's tip is the
commit that merged.

Archived sessions leave the sidebar, the needs-you count, session statuses
and the orchestrator's view, but are never deleted; the **Archived** view
(the workspace switcher for one workspace, or ⋯ in the sidebar header for
all of them) lists
them with Unarchive, which only puts the entry back. What lands there: what
you archived, what Clean up swept, and what sat in Done for 30 days.

**Clean up idle sessions** (the workspace switcher) first shows what will happen
to each idle or stopped session, and `aos done --all-idle` does the same
sweep. A clean-up archives what it finishes, and never merges: open PRs are listed for their own done.
`aos done` reaches only sessions in the caller's workspace (or project).

## Session logs

When a task merges, AgentOS writes a log of it. It costs no model tokens: the
log is a fixed template filled from records AgentOS already holds, and nothing
that makes it can call a model (a test holds it to that). Dropped tasks get
none.

A log holds:

- **Header:** task name and id, workspace, project, branch, PR number and
  link, merge commit, start, merge time and duration.
- **Brief:** the task's prompt and every scope change recorded on it, in
  order.
- **Plan:** `.agentos/plan.md`, read at the merge before cleanup removes the
  worktree. A task with no plan says so.
- **Timeline:** PR opened, gate failures per commit (CI with the failing
  check's name, review, scope), each review and scope verdict per commit with
  its text trimmed, escalations to you and your answers, and the merge.
- **Usage:** tokens, estimated cost and model per role, from the usage ledger.
- **Outcome:** the task agent's last message, verbatim.
- **Links:** the PR and the session.

Text from tasks, CI and reviewers is untrusted. It is written inside fences
or code spans, so it can't add headings or links to the document, and
credential-shaped strings are redacted.

The database is the record: `session_logs`, one row per task, never deleted.
Each log is also written to a file, `YYYY-MM-DD-<task>.md`, in the first of:

1. the project's **Session log folder** (project settings; an absolute or `~`
   path),
2. the workspace's **HQ folder** (workspace settings):
   `<hq>/docs/sessions/<project>/`,
3. `~/.agent-os/session-logs/<workspace>/<project>/`.

A folder inside the project's repository is refused, because repositories can
be public, and the files are never written into one.

The HQ folder is a git repo. Saving it checks that it is a repository, that it
isn't inside or equal to any of the workspace's project repos, and (with one
`gh repo view --json visibility`) that its GitHub remote isn't public; the
result is stored. When a log lands in the HQ it is committed there as
`session log: <task name>`, only that file, whatever else is changed in the
tree, and pushed to the current branch's upstream only if the repo is
private. A failed commit or push is logged and never reaches the merge; the
next push carries the earlier commit. Commits to one HQ run one at a time.
The database row is the record either way.

The same dialog lists the project's logs, newest first, and a merged task's
view has a **Log** tab. The orchestrator reads them with its `logs` tool: the
latest headers of a workspace or project, or one log in full. It only reads.

The log is made once per task, in the background, from wherever the merge
happens: a sign-off, Done, a stack landing, or a merge seen on GitHub. A
failure is logged and never reaches the merge. For tasks that merged before
this existed:

```bash
npx tsx scripts/backfill-session-logs.ts --db <path to agent-os.db> [--no-gh] [--dry] [--reexport]
```

Their plan files are gone, so those logs say "plan not kept". Files go to the
same destinations as above; into an HQ the backfill commits once at the end.
`--reexport` writes no new logs: it rewrites the files of logs already in the
database to where they'd go now, from the stored markdown (no rebuild, no
model), leaves the old files in place, and does nothing on a second run.

## Tmux cleanup

Deleting, finishing, dropping or marking a session done ends its tmux session
and every process its panes started, on the machine it runs on. At start,
AgentOS also ends tmux sessions it created (its `<agent>-<uuid>` and
`aos-chat-<uuid>` names, or the `AGENTOS_SESSION_ID` it sets at launch) whose
session no longer exists, and logs each as `[tmux-sweep]`. Sessions it didn't
create are never touched. The sweep runs only in production mode (a dev or test instance shares the tmux server but not the database); `AGENTOS_TMUX_SWEEP=off` skips it.
