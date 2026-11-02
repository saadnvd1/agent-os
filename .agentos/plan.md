# Forks (experimental): a session starts N children, keeps going, results arrive as they land

Plan only. Mockups: `.agentos/mockup.html` in this worktree (also
`vb ~/.agent-os/audits/branch-session/mockup.html`).

## TLDR

- **What it's for:** unblocking the main session on truly independent
  questions. The parent (usually its agent, mid-task; or Saad from the ⋯
  menu) forks N children with one instruction each and **is free again at
  once**. Saad keeps talking to it, and the agent keeps working.
- **Experimental, off by default.** A new entry in the existing experiments
  registry (Settings → Experimental). When it's off, agents aren't told about
  `aos fork`, the UI has no entry point, and every fork route refuses.
- **Children have the parent's abilities:** the same agent, tools, model,
  permissions and access setting (§4).
  - Each child gets its own scratch folder, removed when it settles.
  - A guard keeps children off the parent's files in the shared checkout.
  - `aos fork --worktree` gives a child a throwaway checkout when it has to
    edit code to find its answer.
  - Builds and tests are allowed, but only through `aos heavy`, which
    queues fork children for a shared heavy slot.
  - There are no PRs and no nesting. Shipped code stays with tasks and plan
    pieces.
- **Children know what the parent knew.** A Claude parent gets a real
  conversation fork (SDK `forkSession`, which shares the prompt cache). Other
  agents get a brief plus a snapshot.
- **Each child is a future.** It's a durable row in the parent's children
  ledger that settles exactly once: returned, failed or cancelled. `aos
children` reads the ledger at any time, and the compaction note lists open
  children, so nothing depends on the conversation remembering.
- **Results never interrupt.** They're delivered at the parent's next turn
  boundary as one batch, one compact row per child, with the full output
  behind `aos children show`.
  - An agent's forks wake an idle parent.
  - Saad's forks hold until his next message.
  - `aos wait children --all|--any` is there when the next step really
    depends on them.
- **Bounded:**
  - Forks count against the running-task limit and wait on the machine-load
    brakes.
  - Cancelling one or all works, and stopping or archiving the parent asks
    what to do with running children.
- **Measured:** every fork logs N, wall clock, the sum of child time
  (speedup), tokens per child, and whether the parent used each result.
  `aos children --stats` and a line in the strip show it.
- **Web only.** The phone app goes to `ideas.md`.
- **The old conductor MCP is removed.** Nothing in the app reaches it today
  (§11), so there's one system, not two.
- **Two pieces:** server + CLI first, then the web UI (§13).

---

## 1. Decisions (Saad, 2026-11-01)

| Question                              | Answer                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Child kind                            | A chat with the parent's abilities: same agent, tools, model, permissions, access (scope change 4, replacing "read-only"). Never a PR. |
| Parent's files                        | Guard by default; a throwaway worktree on request (`--worktree`).                                                                      |
| Agent forks                           | Wake an idle parent.                                                                                                                   |
| Saad's forks                          | Hold results for his next message.                                                                                                     |
| Parent archived with running children | Ask.                                                                                                                                   |
| Nesting                               | Depth 1: a child can't fork.                                                                                                           |
| Context for Claude parents            | Full fork.                                                                                                                             |
| Orchestrator forks                    | Not in V1.                                                                                                                             |

## 2. Patterns, and what each decides

| Pattern              | Here                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Future**           | A child settles exactly once, by a conditional `UPDATE … WHERE settled_at IS NULL`. A late return after a cancel is recorded and never re-settles.                                             |
| **Scatter–gather**   | One `aos fork` with N instructions. Results gather in the ledger in any order, and the group is what `wait --all` and "cancel all" act on.                                                     |
| **Fork–join**        | Only on request (`aos wait children --all`).                                                                                                                                                   |
| **Actor mailbox**    | Results queue for the parent and are handled between turns, never mid-turn. Several settle into one delivery.                                                                                  |
| **Supervisor**       | The parent sees, cancels and decides. There is no auto-restart: a failed child reports, and the parent may re-fork. Stopping the parent asks before it touches children.                       |
| **Backpressure**     | Past the running limit or under load, children sit `queued` instead of being refused. Their heavy commands wait for a shared heavy slot (a counting semaphore) instead of all running at once. |
| **Effectively-once** | A delivery is claimed in the DB before the send, and `sendChat` drops a repeated id, so a restart neither doubles nor drops one.                                                               |

## 3. The flag

- `lib/experiments/registry.ts` gains `{ id: "forks", name: "Parallel forks",
area: "sessions", status: "experimental" }`. Settings → Experimental
  (`components/Settings/ExperimentsSection.tsx`) lists it with no new UI code,
  and `AGENTOS_EXPERIMENTS=off` still pins it off.
- **One server check:** `forksOn()` = `experimentOn("forks")`, used by:
  - every fork route: `POST /api/bus/fork`, `/return`, `/children*`, and the
    session children routes. Each returns 403 `{ error: "Parallel forks are
off (Settings → Experimental)" }`. Exception: reading and cancelling
    children that already exist keeps working after the flag is turned off,
    so nothing is stranded.
  - the bus brief, which only adds the `fork / children / wait children`
    lines while the flag is on. A child's brief carries `return` instead.
  - `GET /api/client-config`, which gains `forks: { enabled, maxPerFork,
summaryChars, deliveryModes, startNote }`. The web hides the ⋯ entry and
    the strip when `enabled` is false. No limit is hardcoded in the UI.
- `bin/aos fork` prints the route's refusal as-is.

## 4. Children: the parent's abilities, the parent's files kept safe

**What a child inherits:** the parent's agent, model, tools, MCP servers,
permission mode and access setting. Approvals it needs go to Saad as
needs-input, as today. The only additions are a scratch folder, the
checkout guard, the heavy gate, no fork, and no PR.

### Scratch folder

- Each child gets `agentosHome("forks", <child id>)`, under the data root
  and never `/tmp`. It's exported as `AOS_SCRATCH` and named in the brief:
  "Temp work (scripts, repros, notes, test output) goes in $AOS_SCRATCH."
- It's removed when the child settles or is dropped (cancelled, its parent
  deleted). `aos return --details` reads its file before removal.
- The tick also sweeps scratch folders whose child is settled or gone, so a
  crash leaves nothing behind.
- If Saad talks to a settled child, it gets a fresh empty scratch folder.

### The parent's checkout: guard by default, worktree on request

**Default: shared folder plus a guard.** The child runs in the parent's
working directory, which the parent keeps working in. The guard
(`lib/fork/guard.ts`, a `ToolGuard` passed through
`lib/chat/worker/extras.ts`, the same path as `lib/orchestrator/worker.ts:41`)
does the following:

- **File tools:** Write, Edit and NotebookEdit are refused for any path
  inside the parent's checkout. That covers tracked files and new untracked
  ones (which would turn up in the parent's `git status` and could be
  committed). Paths are resolved through symlinks and `..` with
  `physicalPath` from `write-guard.ts`. Everywhere else, the parent's access
  setting applies.
- **Shell:** commands are parsed with `lib/orchestrator/shell-parse.ts`
  (pipes, chains, `bash -c`, `env`, `xargs`, substitutions). It refuses
  plain writes aimed into the checkout:
  - redirects, `rm`, `mv`, `cp`, `touch`, `mkdir`, `sed -i`, `tee`
  - `git add|commit|checkout|switch|reset|restore|stash|apply|merge|rebase|clean|push`
  - `npm|pnpm|yarn install/add`
  - `gh pr create`
  - snapshot updates (`-u`, `--update`)
- Each refusal says what to do instead: "work in $AOS_SCRATCH, or ask for
  `aos fork --worktree`".
- Gitignored build output (`.next`, `dist`, coverage) isn't policed: a build
  or test run through `aos heavy` writes there by design.
- **Why the default is the guard:** most children only read, and a guard
  costs nothing at start. A worktree costs seconds to minutes and disk for
  every child. Like the orchestrator's guard (`shell-guard.ts:8`), this one
  catches honest mistakes, not a determined bypass: a script can write
  anything. A child that has to change code takes the worktree, which
  isolates it for real.

**On request: `aos fork --worktree` (or a toggle in Saad's sheet).** It
applies to the whole fork or to marked instructions.

- `git worktree add --detach` from the parent's HEAD, into
  `agentosHome("forks", <child id>, "wt")`. There's no branch.
- The parent's uncommitted diff (`git diff HEAD`, plus untracked files that
  aren't ignored) is applied on top, so the child sees what the parent has
  now.
- The child's conversation fork is written under that folder's slug with
  paths rewritten (`lib/tasks/transcript.ts` `rewritePaths` /
  `writeTranscript`, already used for task moves).
- In its own worktree the child may edit anything. The guard then only
  refuses `git push`, `gh pr create`, and writes into the parent's checkout.
- It's removed with `git worktree remove --force` when the child settles or
  is dropped (the scratch rule), and `git worktree prune` runs in the sweep.
  Nothing from it is ever merged or opened as a PR. A child that found a fix
  reports the diff in its return (`git diff > $AOS_SCRATCH/fix.diff`,
  `--details`), and the parent decides.
- **Cost (estimates, measured in the spike, §14):**
  - `git worktree add` on this repo takes about 1–3 s, plus the diff apply.
  - Dependencies: when the lockfile matches the parent's, `node_modules` is
    a symlink to the parent's (instant, about 0 disk). Otherwise the normal
    worktree setup install runs, which on this repo is about 30–90 s and a
    few hundred MB.
  - The fork output and the strip show "preparing worktree" while that
    happens.

### Builds and tests: allowed, through the heavy gate

- The guard refuses a bare heavy command, meaning anything `heavyLabel()`
  (`lib/load/heavy.ts:75`) recognises (`npm test`, `vitest`, `tsc`, `next
build`, `xcodebuild`, …). The refusal says "run it as `aos heavy -- <cmd>`".
- For a fork child, `aos heavy` first takes a lease from a new
  `POST /api/load/heavy/lease` and waits until it gets one, printing
  "waiting for a heavy slot (2 ahead)". Today it only advises.
  - **Slots:** `forkHeavySlots` per machine is a server option (default 1;
    2 when the load monitor reads low).
  - No new fork lease is granted while `currentLevel()` is high, so the load
    brakes apply directly.
  - Leases are FIFO, carry the pid, are released on exit, and are reclaimed
    when the pid is gone (`STALE_MS` as the cap).
- **Why N children can't swamp the machine:**
  - At most `forkHeavySlots` fork test runs are at once, whatever N is.
  - The children themselves count against `max_running_tasks` (§6) and wait
    on the same load holds to start.
  - The heavy registry still advises everyone else (tasks, Saad) about the
    fork runs.
- Parents' and tasks' `aos heavy` stays advisory, unchanged.

### Agent and nesting

- **Same agent as the parent.** `lib/chat/worker/host.ts:210` refuses a
  role guard on any non-Claude driver, so a non-Claude parent's children
  always get `--worktree` and run with no guard. Their isolation is the
  separate checkout. Their context is the brief and snapshot (§6).
  - The heavy gate still applies, since it lives in `aos heavy`.
  - Bare heavy commands aren't refused for these children (no guard). The
    brief tells them to use `aos heavy`, and the stats record heavy runs per
    child, so a gap shows.
- **No nesting:** the guard refuses `aos fork`, `POST /api/bus/fork` refuses
  a caller with a `session_children` row ("forks can't fork"), and a child's
  brief never mentions fork.
- **No orchestrator forks:** the route refuses `role = 'orchestrator'`, and
  its brief doesn't get the lines.

## 5. The ledger

```sql
-- lib/db/migrations/<UTC ts>_forks.ts (additive)
CREATE TABLE IF NOT EXISTS fork_groups (
  id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,         -- a retried call starts nothing new
  started_by TEXT NOT NULL CHECK (started_by IN ('agent','user')),
  context TEXT NOT NULL CHECK (context IN ('fork','brief')),
  delivery TEXT NOT NULL CHECK (delivery IN ('wake','next')),
  fork_item_id TEXT,                       -- the parent's timeline marker
  created_at INTEGER NOT NULL,
  last_settled_at INTEGER                  -- stats: wall clock
);
CREATE TABLE IF NOT EXISTS session_children (
  child_session_id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES fork_groups(id),
  position INTEGER NOT NULL,               -- "2 of 3"
  label TEXT NOT NULL,
  instruction TEXT NOT NULL,
  state TEXT NOT NULL,                     -- queued|starting|running|needs_input|settled
  outcome TEXT,                            -- ok|failed|cancelled
  summary TEXT,                            -- <= summaryChars, what the parent sees
  result TEXT,                             -- full text, capped (64k)
  result_kind TEXT,                        -- explicit|final_answer
  fell_back INTEGER NOT NULL DEFAULT 0,    -- full fork failed, brief used
  started_at INTEGER, settled_at INTEGER,  -- stats: child duration
  tokens_in INTEGER, tokens_out INTEGER, cache_read INTEGER,  -- stats, at settle
  delivered_at INTEGER, delivery_id TEXT,
  used TEXT,                               -- opened|mentioned|null (§10)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_children_parent ON session_children(parent_session_id, settled_at);
CREATE INDEX IF NOT EXISTS idx_children_undelivered
  ON session_children(parent_session_id) WHERE settled_at IS NOT NULL AND delivered_at IS NULL;
```

- They're tables, not `sessions` columns (adding columns would rebuild the
  `session_rows` view).
- Children get `parent_session_id` and `conductor_session_id` set to the
  parent, which nests them in the sidebar with no new code
  (`lib/sidebar/shelves.ts:354`). A child that needs Saad leaves the nest, as
  today.
- **Reading it:**

```
$ aos children
3 children (1 running, 1 needs input, 1 returned · 1 not yet delivered)
 1 invoices   running      4m  "Which callers still pass cents as floats?"
 2 refunds    needs input  2m  → asks: "Count legacy refunds too?"
 3 exports    ok · new     1m  "CSV and PDF exports both round in format.ts; 3 call sites"
$ aos children show 3 [--json]     # full result and instruction
$ aos children cancel 2|all
$ aos children --stats             # §10
```

Route: `GET /api/bus/children?from=<me>`.

- **Survives compaction and fresh conversations:** `compactContext`
  (`lib/chat/compact-context.ts`) appends an "Open children" block from the
  ledger (labels, states, undelivered summaries), so a fresh conversation
  starts knowing them. A restart loses nothing, because the state is rows and
  the tick re-derives the rest.

## 6. Forking

### The agent

```
aos fork "Which callers pass cents as floats?" "Refund rounding rules" "Export rounding"
  [--labels invoices,refunds,exports] [--brief brief.md | -] [--context fork|brief]
  [--worktree [1,3]]           # throwaway checkout for all, or the listed children
  [-f instructions.txt]        # one per line
```

It returns at once:

```
Forked 3 (g7f2): invoices, refunds, exports. 2 running, 1 queued (task limit).
Keep working; results reach you after your turn. `aos children` shows them; `aos wait children --all` waits.
```

- Route `POST /api/bus/fork` (zod). It takes a `requestId` from the CLI, and
  a repeat returns the first group.
- The server caps N at `maxPerFork` (8). Delivery is `wake` for agent forks.
- The bus brief's lines say when to use it: independent questions that can
  run at once. Not for one quick lookup, and not for code that should ship
  (use tasks; a fork never opens a PR).

### Saad

The chat ⋯ menu (`components/Pane/PaneMenu.tsx`) gets **Fork into parallel
questions…**, shown only when `forks.enabled`.

- It opens a sheet with an instruction list (one child each; pasting a list
  splits it), a context choice (Full fork | Brief), and an **Own throwaway
  checkout** toggle per instruction (off by default).
- Its footer shows the server's start note ("2 start now · 1 queued") and a
  **Fork 3** button.
- Route `POST /api/sessions/[id]/children`. Delivery is `next`.

### Context carrying

- **Claude parent, `fork` (the default):**
  - `forkSession(parentClaudeId, { dir, upToMessageId })`. A shared-folder
    child uses the parent's project slug, so no transcript move is needed. A
    `--worktree` child gets the transcript written under its worktree's slug
    with paths rewritten (§4).
  - The child keeps the parent's model, tools and system append, so the
    cached prefix matches.
  - Its first message is the fork brief plus its instruction ("You are fork 2
    of 3 from _Billing refactor_. Your question: … Temp work goes in
    $AOS_SCRATCH; don't change files in this checkout (the parent is working
    in it); run builds and tests with `aos heavy -- <cmd>`. When done: `aos
return "<one line>" --details -`"). A `--worktree` child is told its
    checkout is its own and throwaway.
- **Fork point mid-turn:** the last complete entry before the assistant
  message that issued `aos fork`, so there's no dangling tool call. A spike
  proves the SDK resumes from that cut (§14). If it doesn't, the cut is the
  end of the last finished turn and the brief restates the current goal.
- **Saad forking an idle parent:** the end of the last finished turn.
- **Non-Claude parent, or `--context brief`:** the brief, plus `--brief`,
  plus a deterministic snapshot: task prompt, the last few exchanges clipped,
  todos, plan, files changed, `git status`. Built from the same pieces as
  `compact-context.ts`.
- The cut is recorded at fork time, and a queued child forks from it when it
  starts (the transcript is append-only).
- A failed fork falls back to the brief for that child (`fell_back`, shown).

### Limits and load

- Children count as running in the workspace's `max_running_tasks`.
  `slotState` (`lib/tasks/queue-rows.ts:156`) adds the open `running` and
  `starting` children in the workspace, so tasks and forks share one budget.
- Before starting, a child also checks `machineHolds` (`lib/tasks/holds.ts`),
  the same load brakes and usage-window holds a task waits on.
- A child that can't start stays `queued` with the hold reason. The
  delivery/settle tick starts it when a slot frees, oldest first.
- A queued child counts toward nothing until it starts.

## 7. A child returns

- **Explicit:** `aos return "<summary>" [--details file.md | -] [--failed]`.
  - The first line is what the parent sees (≤ `summaryChars`, 300, cut if
    longer). The details are the full result (capped at 64k).
  - Route `POST /api/bus/return`: the caller must be a child, and the flag
    must be on, or the child must already be in the ledger.
- **Implicit:** a child whose turn ends idle without `aos return` settles
  with its final answer (summary = its first sentence, cut).
- **Failure:** an error that ends the child's conversation, or the worker
  dying, settles `failed` with the error line.
- **After settling,** a child stays a normal chat Saad can keep talking to. A
  later `aos return` updates `result` and shows "updated". It's re-delivered
  only if the first result wasn't delivered yet.
- `needs_input` (a question or approval, from the status hub's needs-you)
  doesn't settle.
- **Settling cleans up:** the scratch folder and any throwaway worktree are
  removed right after the result is stored (§4).

## 8. Delivery

The tick is `lib/fork/deliver.ts`. It runs from `lib/bus/waits/tick.ts` and
is kicked by `kickWaits()` on every settle and every parent turn end.

1. **Never mid-turn.** A running parent is skipped, and the turn-end kick
   comes back to it.
2. **Batching.** It waits 20 s after the first undelivered result (capped at
   2 min after it), so siblings that land close together go as one message.
3. **Claim, then send:**
   - Set `delivery_id` with a conditional UPDATE.
   - Then `sendChat(parent, { id: delivery_id, queue: true, origin: { kind:
"fork" } })`.
   - A crash between the two just resends the same id, which `sendChat`
     drops.
4. **`wake` (agent forks):**
   - If the parent is idle, the batch starts a turn.
   - If the parent is busy, it queues behind anything already queued, so
     Saad's typed messages go first.
5. **`next` (Saad's forks):**
   - Nothing starts a turn. The strip and timeline show the results at once.
   - The batch is **prepended to the next prompt sent to the parent**: a
     small hook in `lib/chat/runner.ts` `sendChat` calls
     `takeHeldResults(sessionId)` from `lib/fork/deliver.ts`.
   - The composer shows "2 fork results go with your next message".

**What the parent's agent reads** (about 50–80 tokens per child, whatever the
child's output size):

```
[2 fork results, g7f2 "Billing refactor", 1 still running]
✓ 3 exports: CSV and PDF both round in lib/export/format.ts; 3 call sites. Full: aos children show 3
✗ 1 invoices (failed): couldn't find a Money type in lib/billing. Full: aos children show 1
Open: 2 refunds (asks: "Count legacy refunds too?", answer with aos send <id>)
```

The batch item carries `forkResults: [{ child, outcome, summary }]`, so the
web renders it as rows, not a text wall.

## 9. Await on demand

- `aos wait children --all [ids|group] [--timeout 30m]` and `--any`.
- Each is one `bus_waits` row: `kind = 'children'`, `target_id` = the group
  or a comma list. `kind` is free TEXT, so no migration. It counts once
  toward `MAX_OPEN_WAITS`.
- The wake message **is** the delivery for those children: it marks them
  delivered, and §8 won't repeat them.
- On timeout, the parent wakes with what settled and what's open. The
  children keep running.

## 10. Measurement

- **Recorded per fork:**
  - `fork_groups.created_at` → `last_settled_at`: the wall clock.
  - The sum of `settled_at − started_at` over its children: serial time.
  - Speedup = serial ÷ wall. Queue wait is excluded from child time, but it's
    in the wall clock, so queueing shows up as lower speedup.
  - Tokens per child: read from the child's usage totals at settle (the same
    totals the worker keeps today), as `tokens_in` / `tokens_out` /
    `cache_read`. The cache-read share shows whether the fork reused the
    parent's cache.
- **"Used" is a signal, not proof.** It's `opened` when the parent agent ran
  `aos children show <n>` or Saad opened the full result, and `mentioned`
  when the child's label or summary keywords appear in the parent's first
  assistant reply after delivery. It's labelled that way everywhere.
- **Readouts:**
  - `aos children --stats [--days 14]` gives one line per fork group ("g7f2 ·
    3 children · wall 6m · serial 15m · 2.5x · 41k tok (78% cache) · used
    2/3") and a total.
  - The strip's group header gets the same short line once the group is
    settled.
  - Route `GET /api/forks/stats`.

## 11. The old conductor MCP

- **What exists:**
  - `mcp/orchestration-server.ts` (`spawn_worker`, `get_worker_output`, …)
    is only reachable if a session's folder has a `.mcp.json` from
    `lib/mcp-config.ts`.
  - The only writer is `POST /api/sessions/[id]/mcp-config`, and nothing in
    the app or the CLI calls it. Auto-creation was removed (the TODO at
    `app/page.tsx:321`).
  - `lib/orchestration.ts`, `/api/orchestrate/*` and
    `components/ConductorPanel.tsx` only list and kill workers that system
    spawned.
- **So nothing uses it now.** The worker-listing code just stays mounted for
  sessions that have rows from the old days.
- **Piece 1 removes:**
  - `mcp/orchestration-server.ts`, `lib/mcp-config.ts`, the mcp-config route
    and `/api/orchestrate/spawn`.
  - The `ensureMcpConfig` use in `lib/agents/self-env.test.ts`.
- **Piece 2 removes:** `ConductorPanel.tsx`, `/api/orchestrate/workers*`, and
  `lib/orchestration.ts` once the Children strip replaces the panel.
  `killWorker` in `app/api/sessions/[id]/route.ts` becomes the cascade in
  §12.
- CLAUDE.md's "Orchestration" section is rewritten to point at forks.

## 12. Edge cases

| Case                                                              | Behaviour                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Child asks a question**                                         | It goes `needs_input`, and its chip turns amber. Saad sees it as today (it leaves the nest). The next delivery carries "asks: …", and the parent may answer with `aos send <child>`. Whoever answers first unblocks it.                                                                                  |
| **Child stalls**                                                  | No hard timeout. Futures don't expire, and `wait --timeout` covers the blocked case.                                                                                                                                                                                                                     |
| **Cancel one / all**                                              | `aos children cancel <n                                                                                                                                                                                                                                                                                  | all>`, chip **Stop**, group **Cancel all**: stops the child's turn, closes its chat and settles it `cancelled`. It's delivered as a row. |
| **Parent's turn stopped**                                         | Nothing happens to the children.                                                                                                                                                                                                                                                                         |
| **Parent archived, done or dropped**                              | **Ask:** the UI confirm says "3 forks are running: Stop them / Keep them". `aos done` refuses without `--stop-children` or `--keep-children`. A deleted parent (no undo) always cascades `cancelled`. Kept children settle into the ledger, and resurrecting the parent (`lib/resurrect`) delivers them. |
| **Flag turned off while children run**                            | They keep running and settle. Delivery, `children`, `return` and cancel keep working for existing rows. New forks are refused.                                                                                                                                                                           |
| **Parent compacted or refreshed**                                 | The note lists open children (§5). Delivery is unchanged.                                                                                                                                                                                                                                                |
| **Server restart**                                                | Rows are the state. The claim plus the idempotent id means no double and no drop. A child left `starting` is retried once, like the task queue's claimed starts.                                                                                                                                         |
| **N past the limit or under load**                                | `queued` with the hold reason (§6). The CLI and sheet say which.                                                                                                                                                                                                                                         |
| **N children all want to run tests**                              | One heavy lease at a time across fork children (`forkHeavySlots`, §4). The others wait in FIFO with a position, and no lease is granted while load is high.                                                                                                                                              |
| **A child needs to change code to find its answer**               | The guard's refusal points to `--worktree`. The child returns, and the parent (or Saad) re-forks that piece with `--worktree`. The child can't upgrade itself mid-run.                                                                                                                                   |
| **Parent's checkout changed while a worktree child runs**         | No effect: the child works from the snapshot it was cut from. Its return says which HEAD it used.                                                                                                                                                                                                        |
| **Worktree setup fails** (diff doesn't apply, install fails)      | The child settles `failed` with the reason. It never falls back to the shared folder unguarded.                                                                                                                                                                                                          |
| **A child leaves files outside scratch** (per its access setting) | Not cleaned (we only own scratch and the worktree). Its brief says to keep temp work in scratch.                                                                                                                                                                                                         |
| **Same fork sent twice**                                          | `request_id` is unique, so the second call returns the first group.                                                                                                                                                                                                                                      |
| **A child waits on its parent**                                   | Refused (`aos wait` on your own parent: cycle).                                                                                                                                                                                                                                                          |

## 13. Files

### Piece 1, server + CLI (`lib/fork/`, functional)

- `options.ts`: server limits (`maxPerFork` 8, `summaryChars` 300, result
  64k, batching 20 s / 2 min) and `forksOn()`.
- `ledger.ts`: reads and writes; `childrenOf`, `openChildrenNote`.
- `point.ts`, `conversation.ts`, `snapshot.ts`: the fork point, the SDK
  fork, and the brief snapshot. **Shared with the side-chats plan**, which
  needs the same three plus a read-only guard mode. Whichever ships first builds
  them, and a side chat is later "one hidden child with no delivery and a
  manual Send to main chat".
- `guard.ts`: the checkout guard, the bare-heavy refusal, and the no-fork /
  no-PR rules (§4). It reuses `shell-parse.ts` and `physicalPath`.
- `scratch.ts`: create, remove and sweep scratch folders.
- `worktree.ts`: the throwaway worktree (add detached, apply the parent's
  diff, link `node_modules` when the lockfile matches, remove, prune).
- `heavy-lease.ts`: the FIFO fork heavy slots, with the load level check and
  stale-pid reclaim. Route `POST|DELETE /api/load/heavy/lease`; `bin/aos`
  `heavy` takes a lease first when `AOS_FORK_CHILD` is set.
- `brief.ts`: the child's first message and the bus-brief lines.
- `start.ts`: `forkChildren(parent, input)` claims `request_id`, inserts the
  group and children, starts or queues each with a seed applied at first
  start, and writes the fork marker.
- `return.ts`, `settle.ts`, `deliver.ts`, `await.ts`, `cancel.ts`,
  `cascade.ts`, `stats.ts`.

**Routes** (zod, thin):

- `POST /api/bus/fork`, `POST /api/bus/return`
- `GET /api/bus/children`, `POST /api/bus/children/cancel`
- `GET /api/forks/stats`
- `GET|POST /api/sessions/[id]/children`,
  `POST /api/sessions/[id]/children/[childId]/cancel`

`app/api/sessions/[id]/fork/route.ts`, the sidebar's plain Fork (a stub that
never copies `claude_session_id`), is rewired onto `conversation.ts`. It
creates no ledger row and isn't behind the flag, since it's an existing
feature.

**CLI:** `bin/aos` gets `fork`, `return`, `children [show|cancel|--stats]`
and `wait children`, in a helper module it requires, so `bin/aos` doesn't
grow much.

**Edited:**

- `lib/experiments/registry.ts`
- `lib/config/client-config.ts`
- `lib/bus/waits/tick.ts`: deliver/settle and the `children` kind.
- `lib/chat/runner.ts`: the `next` hook, a few lines.
- `lib/chat/events.ts` + `lib/chat/origin.ts`: `"fork"` origin and
  `forkResults`.
- `lib/chat/worker/extras.ts`: the child guard.
- `lib/chat/compact-context.ts`
- `lib/tasks/queue-rows.ts`: `slotState` counts children.
- `lib/sessions/launch.ts`: seed.
- `lib/done/archive.ts`, `lib/resurrect/index.ts`: cascade and held
  results.
- The bus brief.
- CLAUDE.md
- Removals per §11.

### Piece 2, web UI

- `components/Children/{ChildrenStrip,ChildChip,ChildSheet,ResultRows,ForkMarker,ChildOrigin,ReturnedCard,ForkSheet}.tsx`
- `data/children/{keys,queries,mutations}.ts`
- `lib/status/collect.ts`: children in the `/ws/status` push.
- `components/Pane/PaneMenu.tsx`
- `components/Chat/Messages.tsx`: result rows and the fork marker.
- The ConductorPanel removal per §11.

**What it shows:**

- **Children strip** under the pane header while the parent has open or
  undelivered children:
  - One chip per child with a status dot, label, and a short state ("4m",
    "asks", "✓ new").
  - Amber for needs-input, red for failed.
  - The group header says "3 forks · 1 needs you", plus the stats line when
    the group is settled.
- **Chip tap** → a popover with the instruction, state, summary and full
  result, plus **Open**, **Answer** (when it asks) and **Stop**. Group
  actions: **Cancel all** and **Wait for all** (queues the `wait` line as a
  prompt).
- **Timeline:**
  - A fork marker where it happened ("Forked 3 · invoices, refunds,
    exports").
  - A result-rows item where each batch arrived.
  - Held results say "Held for your next message".
- **Child header:**
  - "↳ Fork 2 of 3 from **Billing refactor**" (link), then **Asked:**
    "<instruction>".
  - A folded "Carried context · full fork · ≈ 120k tokens" (estimate from
    the server).
  - A badge: "Shared checkout · guarded" or "Own throwaway checkout".
  - Once settled, a pinned **Returned** card (outcome, time, summary, details
    folded, "Delivered 2:43 PM" or "Held for the parent's next message").
- **Activity line:** "3 forks running" when the parent is idle with open
  children.

### Size watch

- `components/Chat/ChatPanel.tsx` is **923 lines**. Piece 2 splits it first,
  with no behaviour change, in its own commit: `timeline/Item.tsx`,
  `panel/ChatScroller.tsx`, `panel/ChatFooter.tsx`. The strip and child
  header mount from the pane header and `ChatFooter`.
- `lib/chat/worker/host.ts` (**1,117**) isn't touched. The guard arrives
  through `extras`, and seeds apply before the worker starts.
- `lib/chat/runner.ts` gets a few lines that call into `lib/fork/deliver.ts`.
- `lib/orchestrator/write-guard.ts` (530) and `shell-guard.ts` aren't
  edited. `guard.ts` imports only `shell-parse.ts`.

## 14. Tests and verification

**Piece 1 tests:**

- `lib/fork/start.test.ts`:
  - Returns at once with N rows.
  - Refused with the flag off, for a child caller and for an orchestrator.
  - `maxPerFork`.
  - Idempotent `request_id`.
  - Queued past `slotState` and on a machine hold.
- `lib/fork/guard.test.ts`:
  - Allowed: reads, git log/diff, writes and scripts in $AOS_SCRATCH, edits
    outside the checkout per the access setting, and `aos heavy -- npm
test`.
  - Refused inside the parent's checkout: Write/Edit to a tracked or new
    file, a symlinked path that resolves into it, `echo > f`, `sed -i`,
    `git checkout/stash/commit`, `npm install`, `vitest -u`.
  - Refused everywhere: bare `npm test` / `npx vitest` / `tsc` / `bash -c
"npm run build"` (pointed to `aos heavy`), `aos fork`, `git push`, `gh
pr create`.
  - In `--worktree` mode, edits inside its own worktree are allowed.
- `lib/fork/scratch.test.ts`: created under the data root (never `/tmp`),
  removed on settle, cancel and parent delete; the sweep removes orphans.
- `lib/fork/worktree.test.ts` (real git in a temp repo): detached at HEAD,
  the parent's uncommitted diff applied, `node_modules` linked only when
  the lockfile matches, removed and pruned on settle, no branch left.
- `lib/fork/heavy-lease.test.ts`: FIFO, `forkHeavySlots` respected, no new
  lease while load is high, stale pid reclaimed, release on exit.
- `lib/fork/point.test.ts`, `conversation.test.ts`: stubbed SDK; fork id
  stored; fallback on error.
- `lib/fork/return.test.ts`:
  - Summary cut.
  - Update after settle.
  - A late return after cancel isn't re-settled.
  - A non-child is refused.
- `lib/fork/settle.test.ts`: final answer and error settle; needs_input
  doesn't.
- `lib/fork/deliver.test.ts`:
  - Never while running.
  - The batching window, one message per batch.
  - `wake` starts a turn when idle; `next` is held and prepended.
  - Queues behind Saad's message.
  - Claim plus id across a simulated crash.
  - About one line per child.
- `lib/fork/await.test.ts`: `--all`, `--any` and timeout; the wake counts as
  delivery.
- `lib/fork/cascade.test.ts`:
  - Archive with stop and with keep.
  - `aos done` refusal.
  - Resurrect delivers held results.
  - The flag off doesn't strand rows.
- `lib/fork/stats.test.ts`: speedup arithmetic on fixed rows; used =
  opened/mentioned.
- `lib/fork/ledger.test.ts`: `openChildrenNote` in the compaction note.
- `lib/tasks/queue-rows.test.ts`: children count in `slotState`.
- Route tests for every new route folder. `demo.test.ts` covers each new
  `app/api` folder (bus/fork, bus/return, bus/children, forks/stats,
  sessions/[id]/children).
- `app/api/client-config/route.test.ts`, `lib/experiments/registry.test.ts`.
- `lib/bus/children-cli.test.ts`, on the pattern of `wait-cli.test.ts`.
- Removal checks: `lib/agents/self-env.test.ts` updated, and the typecheck
  proves nothing imports the deleted files.

**Piece 2 tests:**

- Component tests for the strip (chips by state, flag off renders nothing),
  result rows and the child header.
- `timeline-selection.test.ts` after the ChatPanel split.

**Run:** `npm run typecheck && npx vitest run <the files above>`, then
`aos heavy -- scripts/check` before the PR. CI runs the full suite.

**Verification:**

1. **Spike first (piece 1):**
   - On the dev instance (`npm run dev:task`, PORT 3121), with a tiny real
     Claude chat (Haiku, two turns), fork mid-turn at the planned cut and
     resume.
   - It passes if the child answers from the parent's history and its
     cache-read is above zero. Otherwise the last-finished-turn cut is used,
     and the PR says so.
   - This is the only real-token run.
2. **Piece 1, `AGENTOS_DEMO=1`:**
   - With the flag on, a demo parent forks 3 and keeps chatting.
   - One returns while the parent is mid-turn and is delivered after, never
     during. One asks a question. One is cancelled.
   - `wait --all` wakes once.
   - A Saad fork holds until a message is sent.
   - A child's bare `npm test` is refused and pointed to `aos heavy`. Three
     children each running `aos heavy -- npm test` run one at a time,
     waiting with a position.
   - A child's Write into the parent's checkout is refused, and its script
     in $AOS_SCRATCH runs. A `--worktree` child edits and runs tests in its
     own checkout. After settle, the scratch folder and worktree are gone
     and `git worktree list` is back to before.
   - The flag off refuses `aos fork` and drops the brief lines.
   - Restarting the dev server between a settle and its delivery gives
     exactly one delivery.
   - `aos children --stats` prints the line.
3. **Piece 2:** the same demo in the browser, at 1440x900 and 390x844, light
   and dark, with rects measured and the console clean. Screenshots of **the
   strip, the result rows, the child header** and the fork sheet go to
   `.agentos/screenshots/` and are named in the PR. The phone app isn't part
   of this.

## 15. Later (`ideas.md`)

Phone app (strip, rows, child header, fork sheet); task children with a PR;
promoting a `--worktree` child's diff into a task; a child upgrading itself
to a worktree mid-run; nesting; orchestrator forks; forking
from an earlier message; summary-of-the-rest carrying; a guard for non-Claude children once other drivers can enforce one;
mixed-agent groups.

## Pieces

1. forks-server: experimental flag `forks`, ledger migration, `lib/fork` (fork point, conversation fork, snapshot, checkout guard, scratch folders, throwaway worktrees, fork heavy lease, start, return, settle, deliver, await, cancel, cascade, stats), bus and session children routes, client-config, `aos fork/return/children/wait children`, compaction note, slotState + load holds, removal of the unused conductor MCP, rewired sidebar Fork (repo: agent-os)
2. forks-web: ChatPanel split, Children strip, result rows, fork marker, child header with Returned card, ⋯ fork sheet, stats line, ConductorPanel retired (repo: agent-os)
   after: 1 is merged
   why split: (b) piece 1 is about 3k lines of server, CLI and tests on its own, and is usable by agents without any UI

## Acceptance

- [ ] With the `forks` experiment off (the default), `aos fork` and every new route refuse, agent briefs have no fork lines and the web shows no fork entry (start, client-config and component tests).
- [ ] `aos fork` returns at once with N children that have the parent's agent, model, tools and access, in the ledger, nested under the parent, counted against the running-task limit and held by the load brakes; the parent keeps taking messages and turns (start tests + demo check).
- [ ] A shared-folder child can't change the parent's checkout (writes refused with a reason), works in its own scratch folder, and `--worktree` children get a throwaway detached checkout; scratch and worktree are removed on settle or drop, and no child can push, open a PR or fork (guard, scratch, worktree tests).
- [ ] Builds and tests from children only run through `aos heavy`, at most `forkHeavySlots` at a time and none while load is high (guard and heavy-lease tests + demo check).
- [ ] Every child settles exactly once, results are delivered only at turn boundaries as one compact batch, agent forks wake an idle parent, Saad's forks wait for his next message, and a restart neither repeats nor drops a delivery (return, settle, deliver tests).
- [ ] `aos wait children --all|--any`, `aos children [show|cancel]`, the compaction note, and the stop/keep prompt on archiving a parent work from the ledger (await, ledger, cascade tests).
- [ ] `aos children --stats` shows N, wall clock, serial time, speedup, tokens per child and used results for each fork; the unused conductor MCP server is gone and no file passes ~900 lines (stats tests, typecheck).
- [ ] The strip, result rows and child header are checked at 1440x900 and 390x844 in light and dark, with screenshots named in the PR, and `aos heavy -- scripts/check` passes.

## Build notes (one PR)

- Pieces 1 and 2 were built as ONE PR: the web piece's reason to wait did not hold.
- Deadlock rule: a parent's first open child always starts, even past the workspace slot limit (test: limit 1, parent, 3 children, `--all` wait finishes).
- Implicit settle: a child idle without `aos return` settles with its final answer after the grace (45s), recorded as `implicit`; stats tell it apart. Questions use `aos send <parent> --await`, which does not settle.
- The old sidebar "Fork" (duplicate a session) is a separate feature and was left alone.
- Not run: a real-token spike of a mid-turn cut; a failed cut falls back to a brief.
- Phone app: parked in `ideas.md`, belongs to another repository.
