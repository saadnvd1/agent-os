# Agent-OS Future Ideas

## Features

- [ ] Notifications - Alert when session needs attention (waiting state, errors, completed tasks)
- [ ] MCP server integration - Toggle AI capabilities (web search, GitHub) per session
- [ ] Session templates - Pre-configured sessions for common tasks
- [ ] Session groups - Organize sessions into projects/folders
- [ ] Session search - Fuzzy search across all conversations
- [ ] Export conversations - Export to Markdown/JSON
- [ ] Keyboard shortcuts - Quick navigation and actions
- [x] Mobile responsive - Better mobile layout
- [ ] Dark/light theme toggle

## Updates

- [ ] Only show the update banner for minor releases (every merge is a new version today)
- [ ] Release notes written per release, instead of the merged PR titles

## Machines (after multi-host V1)

- [ ] Files, git and worktrees for sessions on other machines (run git over the host exec layer)
- [ ] Persist pane layouts per workspace in the DB instead of localStorage
- [ ] Merge "groups" into projects (one concept)
- [ ] Attention queue: pin sessions waiting on you to the top
- [ ] Resume Claude after a reboot from a recorded session id
- [ ] Replace status polling with tmux hooks/control mode events
- [ ] Auto balance: when starting a task, pick the machine (this one or a linked one) with the most free CPU and memory

## Tasks (after V1, 2026-10-05)

- [ ] Prune `refs/agentos/ended/*` snapshots after 30 days, and show a snapshot's file count before a restore

- [ ] Run tasks on other machines (worktree + tmux over the host exec layer)
- [ ] Notify (push/Telegram) when a task needs you or is ready for review
- [ ] Model picker and per-project brief additions in New task
- [ ] Answer a blocked task from the panel without opening the terminal
- [ ] Resume an exited task with `claude --resume`
- [ ] Per-task dev server port and database, as dispatch does

## Composer follow-ups (from PR #84 review)

- [ ] Reset the pasted-text attachment counter after sending, so a new message starts at pasted-text.txt
- [ ] Keep NUL characters in pasted text (the lazy-line marker uses \u0000 and strips them)
- [ ] Decide on CRLF: pasted Windows line endings are normalised to LF
- [ ] Tests: typing in the editor serialises to what was typed; a broken draft loads as plain text

## Workspace orchestrator

- [ ] One standing orchestrator per workspace: see docs/plans/workspace-orchestrator.md
      (after stacks and the TipTap composer ship)
- [ ] From a live run (Internal Tools orchestrator, 2026-10-06), not in part C:
  - Its MCP tools (`sessions`, `read`) began answering "Not the orchestrator" mid-run, and `aos peers` showed it "not running". Likely cause: its chat worker started on part A's code (workers keep old code until idle or closed), so it has no part B tools and sends no `x-agentos-orchestrator` token, which part B's route requires. Fix: when the orchestrator's tool set or brief changes, restart its worker between turns (or tell it its toolset is stale).
  - `aos stop` / `aos drop <session>` as a CLI fallback scoped to the caller's workspace (drop refuses with an open PR unless `--force`), and a cleanup verb (`aos sessions --prune`) that stops idle sessions whose work is merged or reported.
  - Session sprawl: one-shot review/merge sessions spawned over `aos` pile up idle. Point orchestrators at `review`/`sign_off`/`stop`/`drop` (part B) and auto-close one-shot spawns once they report back.
  - Noisy events: "needs input" for a session that's just done, and "CI green" for a head its review already blocked.

## Chat (after V1)

- [ ] Drivers for Codex, OpenCode and others (lib/chat/drivers)
- [x] Approval prompts as an opt-in permission level (access picker)
- [ ] Plan mode: `/plan`, a proposed-plan card, and "build it" to switch access
- [ ] Import turns made in the terminal when switching back to chat
- [ ] "Open as chat" for tmux sessions AgentOS didn't start: find the Claude
      conversation running there, create a session that resumes it in chat,
      and close the tmux session
- [ ] Chat for sessions on other machines (via the per-machine AgentOS)
- [x] Checkpoints: undo a turn's file changes
- [ ] Undo for shell-command changes too (git stash/snapshot per turn), since
      SDK checkpoints only cover the file-edit tools
- [ ] Context-usage meter in the composer
- [x] Durable chat: run each chat conversation
      in its own worker process (hosted in tmux, like terminal sessions) so a
      server restart no longer kills a turn in flight. The worker owns the
      agent and writes every item to SQLite before it's shown; the server
      becomes a viewer that reattaches after a restart, and the worker
      resumes an interrupted turn when it starts. Sends carry an id so a
      retried send is never run twice. (Done 2026-10-06, no flag.)
- [ ] Resume a turn when its worker itself crashed (the worker, not the
      server): record the in-flight send and re-send it on the next start
- [ ] Start a chat's worker on the first composer keystroke, to hide the
      0.5–2.6 s a cold send still waits (costs a CLI process per chat opened)
- [ ] Show the message the moment the worker is up even when the access or
      plan setting changed while it was down (it still waits for the CLI)
- [ ] Collapse very long user messages behind "Show all"
- [ ] Pending and failed send bubbles in the native app (agentos-mobile),
      with the `clientId`, `accepted` and `send_failed` the server now has

## Tooling

- [ ] Refactor the 21 React Compiler warnings (set-state-in-effect, refs) and make them errors

## Technical

- [ ] Message streaming improvements - Better partial message handling
- [ ] Tool call persistence - Store tool calls in database
- [ ] Session snapshots - Save/restore session state
- [ ] Multiple working directories per session
- [ ] Claude model selection per session
- [ ] Rate limiting / queue for parallel sessions
- [ ] WebSocket reconnection handling
- [ ] Session auto-save/recovery

## Performance (after the 2026-10-07 audit)

- [ ] Virtualize long chats: a 600-item chat mounts ~3,900 DOM nodes and its
      first render is most of the chat page's LCP (~8s on a throttled phone)
- [ ] Move the status query out of HomeContent: every push re-renders the page
      shell, the views and the panes' props (rows and dialogs are memoized now)
- [ ] Layout shift (CLS ~0.19) on chat and terminal pages as the pane's bars and
      keybar settle after hydration
- [ ] Memoize the Composer's props (history, handlers) so a streamed word
      doesn't re-render its toolbar
- [ ] The remaining sync git calls (stage, commit, push, history, PR) off the
      event loop, like the polled status reads

## Workspaces (inspired by catnip)

- [ ] Project-tied workspaces - Sessions grouped by project, not just folders
- [ ] Auto dev server management - Each worktree gets its own dev server with unique port
- [ ] Parallel development environments - Run multiple features simultaneously with isolated servers
- [ ] Workspace dashboard - See all active worktrees, their branches, ports, and session status
- [ ] One-click environment spin-up - Create worktree + session + dev server in single action
- [ ] Port forwarding UI - View/manage all running dev servers across worktrees
- [ ] Worktree health monitoring - Track build status, test results per environment

## LumifyHub (after V1, 2026-10-06)

- [ ] Tokens scoped to one workspace, so a connected AgentOS can't touch the rest of the account
- [ ] Webhooks from LumifyHub so card changes reach AgentOS without polling
- [ ] A deep link to a workspace's members/invites settings (LumifyHub has no URL for it yet)
- [ ] Agents read and write their own card (status notes, checklists) through `aos`
- [ ] Re-publish refreshes the page in LumifyHub's editor (an open editor keeps showing old text)

## Integration

- [ ] tmux session linking - Attach Claude to existing tmux sessions
- [ ] Git integration - Show repo status in session header
- [ ] File browser - Browse working directory
- [ ] Image/file upload support
- [ ] Voice input/output
- [ ] Orchestrator "Start fresh": end the current conversation but keep its asks, notes and in-flight tasks (today each workspace has exactly one orchestrator, forever)
- [ ] Sidebar phone polish: titles cut off early (move ⋯ to long-press/swipe), shorter orchestrator subtitle, nested worker dot follows its own status, compact inline asks (title + Approve, detail in chat)
- [ ] PR #98: review the stricter fail-closed code-review gate against what #97 already put on main; merge the new parts or drop it
- [ ] Move a task between two other machines directly (today a move goes through this one)
- [ ] Move a plain session (not a task) between machines when it's in its own worktree: push WIP to its branch, recreate it there, resume the conversation. Today only tasks move; a plain session has no task status for the move's claim/resume/mirror to hang on, and one in the project's own checkout has no branch of its own to push
- [ ] Interactive and chat sessions on a linked machine through its AgentOS, like tasks (still ssh today)

## Other agents in chat

- [ ] Codex plan mode (its collaboration mode is still behind `experimentalApi`)
- [ ] Undo in Codex chat via `thread/revert`, OpenCode via its session revert
- [ ] `@file` suggestions for Codex (`fuzzyFileSearch`) and OpenCode (`/find/file`)
- [ ] One shared `opencode serve` per machine instead of one per conversation, with orphan reaping
- [ ] Visuals (html_render) for non-Claude agents, as an MCP server they load
- [ ] Chat drivers for Gemini CLI (`--experimental-acp`), Cursor and Amp (`--stream-json`)
- [ ] The composer keeps the last session's model list until the new session's arrives

## Draft-first sessions (after V1, 2026-10-07)

- Stream install output into the setup card's log as it prints, not per step.
- A draft for another machine shows that machine's installed agents (today
  the install check is this machine's only, so a remote draft shows them all).
- Folder browser in the project's settings for changing its folder.
- The chat's access chip reads "Full access" until the worker's capabilities
  arrive (useChat's default), even when the session is "Accept edits".

- Terminal agents get the post-compaction note too: a SessionStart (compact)
  hook calling an authenticated route that returns `compactContext`. Chats
  have it; the other chat drivers (codex, opencode, pi) only get the
  summary instructions.

- Usage ledger: record the one-shot helper runs (PR text, summaries, titles) and give check runs the 1h cache
  write split if the CLI result starts carrying it.

- Push: quiet hours (iOS Focus covers it per device for now), push-only enrolment so a tailnet-only
  machine can send without a tunnel, and an encrypted v2 body decrypted on the phone.

- Orchestrator task moves: a pre-push guard for the default branch on the machine that holds a task; moving card and stacked tasks; releasing a hold whose device was revoked; showing the plan view of a held task by proxying it, and disabling Merge, Move and Arm for held rows in the arriving machine's UI ("run by <machine>").

- First-run welcome, next: suggest projects from agent-CLI session history
  (read each CLI's recorded folders, keep the git repos still on disk, group
  by remote, pre-select the recently active), probe agents on linked
  machines, a machines/phone/notifications step, an in-app health view
  (node, git, tmux, CLIs) with a test that the shell installer and the app
  agree on the minimum node and the install commands, and web-push opt-in.

- Send to background, next: a toolbar button in the terminal view that sends the agent's own background key straight to the pane (send-keys, not the attached client, so tmux's prefix doesn't swallow it; through the host for a linked machine), shown only while the screen says a tool is running; mapping `background_tasks_changed` as a reconcile for a missed task_notification; a push for a background task that fails while the reader is away.

## iOS simulator for tasks (after V1)

- [ ] Task row indicator and a strip of the task's latest simulator screenshots
- [ ] An MCP server (agent-device's, or an in-process chat tool) if `aos sim` proves clumsy
- [ ] Settings for the booted cap and idle timeout (env var only for now)
- [ ] A Release build with the bundle embedded, for checks without Metro
- [ ] Record a check as a replayable script
- [ ] Android emulator through the same lease

- Resolve an open orchestrator question from a freeform chat reply, without the strip's Reply or the orchestrator clearing it.
- Fold event turns in task chats the way the orchestrator's chat does.
- GitHub Copilot, next: its model list in the chat picker (ACP lists none on
  some plans; read `copilot --help`'s catalog or `session/set_model` when it
  appears) and switching model mid-chat; plan mode (`--plan`/`--mode plan`);
  terminal-view tasks and schedules (`launchClaude` is Claude's); an agent
  picker in the new-task dialog and `aos task --agent`, and the orchestrator's
  `start_task`; tasks on a linked machine; terminal-view status patterns
  (busy footer, permission prompt) in `status-detector`; credit usage from
  `--usage-output-file` (AI credits, not USD) and rate limits; MCP servers
  (pass AgentOS's through `session/new` `mcpServers`) and in-chat visuals;
  the toolGuard/role rails (ACP has no pre-tool hook, so a role with a guard
  can't run on it); suppress Copilot's own `Co-authored-by` trailer at the
  source (`includeCoAuthoredBy` is a user setting, so only the commit-msg hook
  and the PR-body check stop it today); undo; fork; `/` commands from
  `available_commands_update`.
- Kiro CLI, next: a chat driver over `kiro-cli chat --no-interactive
--output-format stream-json` once its event schema is documented; a resume
  finder (`--resume-id`) once its session store is read from a real install
  (`lib/providers/resume-ids.ts`) and flip Resume on; pre-fill an Identity
  Center start URL and region per project for `login`; the sign-in card for
  the Welcome terminal.
- Ongoing and Snoozed, next: a custom snooze time ("Pick a time…"); a push to
  the phone when a snooze wakes (today a woken session only carries the dot);
  a snooze that waits for a task's PR or checks rather than a clock; the
  desktop sidebar's keyboard row navigation (there is none yet) in the new
  shelf order.

## Learning cards

- [ ] Compare briefs with a cheap stored embedding as well as word overlap
- [ ] A pruning view of applied lessons (the `learning_cards` accepted rows)
- [ ] Learning cards on mobile
- [ ] Auto-apply a destination once its accept rate justifies it

- Share links, next: a separate registered user-content domain for shared
  pages (protection against a domain-wide blocklist; a purchase); live links
  that update; Mermaid diagrams in snapshots (they show as code today); share
  from the native app; per-day view counts.
- [ ] `DELETE /api/devices/:id` has no approver check: any paired device can sign another out (it only removes approval power, never grants it)

## Task scheduling, next

- [ ] Hold or penalise a start that overlaps a running task's files (a plan's file list, paths named in the brief, migrations), with "waiting: overlaps X in <file>" in the row
- [ ] The scheduler pauses low-priority running work while a machine is red and resumes it when load drops (hysteresis), never mid-push or mid-merge
- [ ] A graded usage-window term in the score instead of the brakes' all-or-nothing hold
- [ ] A project settings screen for `machine.needs` (today: `agentos.json`, brief tag or inferred)
- [ ] Move a paused task to a linked machine
- [ ] A task pausing itself (`aos pause`, turn boundary only)
- [ ] Placement for plan-only and plan-first tasks (`startRemoteTask` refuses them today)

## Model routing and token savings

- [x] Run read-only search subagents on a cheaper model than the parent session
- [ ] A/B Sonnet against the parent model for reviewer subagents before changing the never-Haiku rule
- [ ] Compact long Opus chats earlier so fewer turns re-read a very large context
- [x] Gate review: put the checklist in a cache-stable prefix instead of repeating it in every diff part
- [ ] The card scope check re-sends the card and file list with every diff part; give it the same stable prefix
- [ ] Record usage for titles, recipe drafts, PR text and summaries; bound the summarize input; run PR text through the hardened runner
- [ ] Measure the extra model call behind chat prompt suggestions, then decide whether to keep it
- [ ] Keep the scope check and gate review off Haiku

## Bookmarks (after V1)

- Labels or colours on bookmarks, and filtering by them.
- Share one bookmarked message as a link (`lib/share/render.tsx` for one item).
- Export bookmarks to Markdown (`lib/share/markdown.ts`) or a LumifyHub page.
- A read-only `list_bookmarks` tool for the orchestrator, and `aos bookmarks`.
- Jump to a very old bookmark without paging back: a `history` request
  `around` a seq.
- Bookmark a text selection inside a message (a range, not a whole item).
- Bookmarks on terminal-view sessions (they have no item ids).
- A star on a collapsed run of steps when one of its tool calls is bookmarked.
- Shared build caches harvested from finished worktrees into a store, so a cache newer than the main checkout's seeds the next one. Left out because one agent's cache would then be trusted by another's typecheck or build.
- On a lockfile mismatch, seed node_modules and run the install for the delta only (`npm ci` deletes node_modules first, so it needs `npm install` and a guard that the worktree's lockfile isn't rewritten).
- Sweep stale `aos-quick-repo-*` worktrees left under the worktrees folder.
