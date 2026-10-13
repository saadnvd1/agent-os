# Orchestrator

Every workspace has one orchestrator, a chat pinned at the top of its list.
It starts tasks, answers agents that are blocked, and reviews and merges
pull requests through gates: CI green and settled, an independent review of
the exact commit (big diffs are reviewed in parts), nothing blocked, and the
diff in scope. Anything that is yours to
decide (publishing, money, something irreversible, credentials) waits as an
ask with Approve, Decline and Reply. Turn on **Require my approval** and
sensitive or large PRs wait for you too.

![The Work orchestrator's chat, with two asks waiting: a merge gate and a public post](../../screenshots/orchestrator.png)

Each workspace has one standing orchestrator, pinned at the top of its
section: a chat that runs the work across the workspace's projects. It's made
the first time you open it, works from a scratch folder in
`~/.agent-os/orchestrators/<workspace>`, and is never swept with idle sessions.
Its brief lists the workspace's projects (path, board, default branch), what
it may do on its own, and the lines that always come back to you as asks.

- **Tools:** `sessions` (every session's status, activity, task, PR, CI and
  stack position), `read` (the end of a terminal or chat) and `cards` (the
  linked boards' cards), plus acting tools: `send`, `start_task`,
  `start_session`, `stack`, `stack_status`, `land`, `drop`, `stop`, `done`, `move`,
  `add_project` (a git repository on the machine becomes a project of the
  workspace, or the project already at that path moves in from no workspace;
  folders that hold secrets and projects of another workspace are refused),
  `note`,
  `rule_add`, `rule_remove`, `review`, `sign_off`, `arm`, `disarm`, `remind_me`, `reminders`, `cancel_reminder`, `ask_saad`, `question` and `resolve_question`. All are served in-process to its chat, refuse
  any target outside its workspace, and validate their arguments. The one
  exception is other orchestrators: `orchestrators` lists every workspace and
  whether it has one, and `message_orchestrator` messages another workspace's
  current orchestrator by workspace name (never any other session there). It
  arrives marked as from that orchestrator and fenced as untrusted, so it can't
  approve, answer an ask or pass a gate. The route
  they call answers only the orchestrator's worker, by a per-orchestrator
  secret.
- **Shell:** it runs anything without asking, so an orchestrator can read and
  investigate on its own: `gh pr list`, `gh run view --log-failed`, `gh api`
  GETs, `curl`, `sqlite3 -readonly`, git in any repository, a skill's scripts,
  pipes and chains. Its chat worker refuses a deny list before a command runs,
  naming the tool to use instead: merging, closing or retargeting a PR
  (`gh pr merge`, `gh pr close`, `gh pr edit --base`, and `gh api` or `curl`
  calls that merge a pull request or PATCH or PUT one; use `sign_off`, `arm`,
  `land` or `drop`), `aos move`, `aos done` and `aos stop` (use `move`, `done` and
  `stop`, which are scoped to the workspace and held by Pause), `git push` (`quick_pr` pushes), writing in a project
  repository or task worktree other than its own open quick changes (git
  commit, reset, checkout, rebase, merge, stash, clean or rm there, and `rm`,
  `mv`, `cp`, `tee` or a redirect into one), writing AgentOS's state (`sqlite3`
  on its database without `-readonly` or with INSERT, UPDATE, DELETE, DROP,
  ALTER or ATTACH; files under `~/.agent-os` outside its folder), stopping
  AgentOS or its tmux (`pkill`/`kill` aimed at it, `tmux kill-*`, a
  `launchctl` or `serviceman` restart), and reading secret files (the same
  list as the write guard; tokenvault is allowed, through `tv` and its folders). It reads each
  command line the way a shell would, so these are caught inside pipes,
  chains and `$( )`, behind `bash -c`, `sh -c`, `env`, `sudo`, `xargs`,
  `find -exec` or an absolute path, and after a `cd` or `git -C`. **The deny
  list catches honest mistakes, not a determined bypass:** a script or
  `python -c` can do any of these where no parser sees it, and an
  orchestrator reads other sessions' text, which can carry planted
  instructions. The trade-off was chosen on 2026-10-11, for an orchestrator
  that does its own investigating instead of handing it to him.
- **Triage:** its brief has it decide each job: small and clear is a task with
  `plan: false` and the steps written into the brief; big, unclear or
  cross-cutting is `plan: true`; work outside a repository is a
  `start_session` (Sonnet) with the steps in the prompt. It puts
  implementation on Opus only when the work needs deep reasoning, and says why.
- **Files:** it reads anywhere and writes (Write, Edit, NotebookEdit) anywhere
  except a project repository, a task worktree (`~/.agent-os/worktrees`),
  AgentOS's own install and state (all of `~/.agent-os` but its own folder),
  secret files (`.env`, keys, `~/.ssh`, `~/.aws`, `gh`'s token, tokenvault and
  the like; the list the merge gates use for secrets handling,
  `lib/secret-paths.ts`), and files that make something run: dotfiles and
  dot-folders at the top of its home (shell, git, Claude and tool config, the
  usage brake's `limits.json`), `~/Library`, `/Library/LaunchAgents` and
  `LaunchDaemons`, git's `core.hooksPath` folders (yours and each project's),
  the folders on `PATH`, and any `.git`, `.claude`, `.mcp.json`, `CLAUDE.md`
  or `AGENTS.md`, since writing one would give it a shell or run code in
  AgentOS's own git; and the temporary checkouts a review or rebase runs in.
  Code changes to a project go through a task, so its PR still passes CI,
  review and scope. It is a list of exceptions, not of allowed places: a
  script a hook or scheduled job runs from an ordinary folder can still be
  written, so an orchestrator misled by text it read could run code that way.
  That's accepted: task agents can already write anywhere, so an allowlist
  on the orchestrator alone would buy little.
- **MCP servers.** An orchestrator runs without prompts, so an MCP server's
  tools are refused unless its workspace allows the server. Settings →
  Workspaces lists the servers configured on the machine (names only: user
  servers, connectors and plugin servers; never their env, headers or tokens)
  as toggles, and `linear` is allowed by default. A ticked server adds a bare
  `mcp__<server>` rule to the orchestrator's allowed tools, covering all its
  tools. Its worker ends at its next turn boundary when the list changes, and
  the next one starts with the new permissions. Sending a message, email or
  post through a server stays a hard line the brief sends to `ask_saad`.
  Its chat worker checks every write in a PreToolUse hook before it runs, on
  the path with symlinks and `..` resolved as the system will, and refuses
  with the reason; the repositories are read from the database on each write,
  so a project added since counts. A worker from before an update picks the
  new permissions up at its handover to the new build.
- **Brakes:** every start is refused, with the reason, while 4 sessions run in
  the workspace, after 6 starts in an hour (`orch_max_running` and
  `orch_max_starts_per_hour` on `workspaces`), or when the account's 5-hour
  usage window would run out before it resets (read from the statusline's
  `~/.claude/.context-cost/limits.json`, as dispatch does;
  `AGENTOS_LIMITS_FILE` overrides). A missing file, or one not sampled for 15
  minutes, refuses too. Each card of a stack it starts is braked as its own
  start. A brake writes one note and pauses only new starts.
- **Review and sign-off:** `review` runs a fresh `claude -p` on a
  symlink-free detached checkout of the PR's exact head commit. It loads no
  settings or MCP servers from anywhere (so nothing the PR ships runs), gets
  an allowlisted environment, can only Read/Grep/Glob inside the checkout,
  and follows the repo's review agents' rules (`.claude/agents/review-*.md`), or its review skill, as the base branch has them. The verdict
  is stored against that sha. A diff over 80k characters is reviewed in up
  to 6 parts of whole files, each against the task, and fails if any part
  does; a single file over 80k, or more than 6 parts, goes to you. A task from a card also gets a scope check against the card.
  When you change a running task's scope, the orchestrator tells it with
  `send` and `scope_change`, which records the message on the task's brief
  (`brief_amendments`, logged in its chat): the review and the card's scope
  check judge the PR against the brief as amended, the amendments winning,
  and a "Scope change" note in the PR body counts only where one backs it.
  `sign_off` merges only that commit (with the project's merge method) when CI is green and settled on
  it (2 minutes with no new check), its review passed, nothing is
  `BLOCKED:` or waiting, the diff stays in scope (no secrets, not only
  lockfiles, nothing outside the repo, within the card) and its stack parent
  has merged, and the PR body carries no AI attribution. `land` judges each item again at its own head right before
  merging it. A gate failing again on a different commit, or a repo with no
  CI, goes to you as an ask, and the orchestrator stops merging that task.
  A failure counts once per task, gate and head commit, however many times
  and from wherever that commit is judged (the armed watcher, CI finishing,
  `sign_off`, `done`, `land`); a pass in between doesn't reset it. A review
  that blocks counts when its verdict arrives, whether or not `sign_off`
  ever reads it.
- **Arm to merge:** `arm` (or **Arm merge** on a task's row) makes AgentOS
  merge the task's PR itself the moment every `sign_off` gate passes at its
  head, starting the review once CI is green, so nothing polls `sign_off`.
  The orchestrator hears one event: merged, or the failure (counted once per
  head; the task stays armed for the fix, and one that goes to you disarms
  it). The flag is in the database, so it survives a restart; `disarm`
  takes it back.
- **Automatic rebase:** when the base moves and GitHub says a task's PR now
  conflicts (read in the PR poll AgentOS already makes), `git merge-tree`
  checks it against the base. Clean, and with the task's agent idle and
  nothing uncommitted, AgentOS rebases it in the task's worktree and pushes
  only its branch with `--force-with-lease`, and the orchestrator's review
  carries over when the PR's own patch is
  unchanged (same `git patch-id`; a fresh review starts otherwise). Your
  merge approval carries over a rebase the same way (any rebase, the task's
  own included): when the PR's patch is unchanged it follows the new head,
  else you're asked again, naming the new head and what changed, and an open
  merge ask follows its PR's head. Not
  clean: the task is asked once to rebase. Either way, one event. Main and
  other tasks' branches are never written.
- **Tasks woken on CI failures and reviews:** a check failing on a task's
  PR head messages the task's own agent once per head, with the check, the
  failing step and about 60 lines of `gh run view --log-failed` around the
  error, telling it to fix the root cause and push. A review or comment from a collaborator (not the account gh runs
  as, which is the task's own) wakes it once per review or comment; one
  GraphQL query per repository a minute fingerprints the open task PRs, and
  only a PR whose fingerprint moved has its reviews read. Comment-only wakes
  stop at 10 a task; changes requested always wake. A task mid-turn gets it
  queued, the orchestrator hears one line per wake, and merged, closed,
  dropped or done tasks aren't watched. On by default; **Settings →
  Workspaces** turns it off per workspace.
- **External PRs and sessions:** `review` and `sign_off` also take an open
  PR no AgentOS task owns (dispatch, a person, dependabot) by `#N`,
  `owner/repo#N` or URL, as long as its repository is one of the workspace's
  projects; anything else is refused. The same gates apply, except that a
  draft waits and a "blocked", "do not merge" or "wip" label holds it (there's
  no session to read). `sessions` also lists tmux
  sessions AgentOS didn't start that work in a workspace repository or a
  worktree of it, here or on another machine, with their branch's PR; `read`
  reads them, and nothing else acts on them.
- **Merge approvals** (Settings → Merging, off by default): on, any change to
  CI config, build and hook scripts, agent config, deploy scripts, secrets
  handling or AgentOS's security code, and any diff over 80k characters, goes
  to you as an ask whatever the gates say, and merges once on your passkey.
  Off, those merge through the gates like any other PR. Switching it off
  again needs your passkey.
- **Decision log:** `note` and the brakes and escalations write to
  `orchestrator_notes`, and each line shows in its chat.
- **Standing rules:** what it must keep knowing ("never merge #111", "briefs
  must not name third-party products") it keeps with `rule_add` and drops with
  `rule_remove`, in `orchestrator_rules`. You see, add, edit and remove them in
  Settings → Workspaces, each change with your passkey (any process on the
  machine reaches the route, and a rule of yours is your word to it). A rule restricts or informs; it never approves an
  ask, passes a gate or clears a hard line. Yours are marked as from you and
  only you remove them; the ones it kept, like its decision-log lines, come
  back to it fenced as its own notes, so text it read can't pass for your
  word. Rule text is redacted when stored, and removed rules stay on record.
- **Where things stand:** every start appends a digest read straight from
  the database, no model involved: the standing rules, open asks, running
  tasks with their PR, armed-to-merge and gate state, recently gated external
  PRs, the queue, schedules and the newest decision-log lines, capped at about
  4k tokens. The brief tells it this is authoritative over what it remembers.
- **Fresh starts:** fed events nonstop, an orchestrator never idles and can't
  compact itself. Once its context passes a threshold (200k tokens by
  default, Settings → Workspaces → Fresh starts), its worker ends the
  conversation at the next turn boundary and the next one starts a new
  conversation with the brief and digest, telling the agent in one line why.
  Nothing is lost, because its state lives in the database; its chat goes on,
  with a line where it started over. The same can be switched on for chat
  tasks (off by default: a task keeps only its brief and its branch).
  **Start fresh by hand:** after a deploy that changes its permissions or
  brief, use **New conversation (keep brief)** in the orchestrator's row menu or type `/fresh`
  in its chat (task chats have both too). It takes the threshold's path: an
  idle agent starts over at once; a running turn finishes first, with a
  "Starts fresh after this turn" line. The next conversation launches with
  the brief, permissions and workspace state the server has then.
- **Events:** the server sends it one short line per event (a PR opened, CI
  failed, or green once it has settled so `sign_off`'s ci gate passes, a `BLOCKED:` line, a merge, a session needing input, a
  stack step, a task idle 30 minutes with no PR, a review's verdict). Events
  wait while its turn runs, duplicates fold, and at most one batched message
  goes out per 30 seconds. What it has been told is kept in
  `orchestrator_events`, so a restart resends nothing. Set
  `AGENTOS_ORCHESTRATOR=off` to stop events.
- **Asks:** what's yours to decide sits on its asks list
  (`orchestrator_asks`): what it raises with `ask_saad` (a decision, or
  something crossing a hard line: public or outbound, money, irreversible,
  credentials, a product call), and every escalated gate and brake. There's
  one open ask per subject (a task, the brakes, a title), so an escalation
  that repeats updates its ask. Each shows as a card under its row and at the
  top of its chat, with Approve, Decline and Reply. Open asks are its
  needs-you: the amber dot, one count each in "N need you", and the
  notifications. Your answer reaches it as an event (`ask "<title>":
approved`). An approval covers that one item only: a held task's approval
  lets `sign_off` merge it once, at the commit you approved (a new commit
  asks again), and a brake's lets one start through, for that brake only.
  The orchestrator can ask you itself whether to merge a PR the gates won't
  pass, by giving `ask_saad` the task and its head sha: the ask is pinned to
  that commit, opens with what AgentOS knows about it (files changed,
  sensitive files, the review's verdict) and links the PR, and your approval
  lets `sign_off` merge it once, at that commit. It never rewrites an ask the
  gates raised. An approved merge (either kind, and an armed task's) needs no
  review or other gate of that commit: only an AI-attributed PR body, failing
  CI (running CI waits), a head that moved off the commit, and on the
  orchestrator's own ask a stack parent not merged yet, still stop it.
  An ask closes itself when its task is merged or dropped, or the brakes
  lift. At most 10 are open per workspace, titles that say the same thing
  fold into one, a declined subject isn't asked again for 6 hours, and a
  "decision" that reads as money, outbound, irreversible or credentials is
  filed as that hard line.
- **Readable when busy:** in the orchestrator's chat, anything AgentOS
  sent it (a PR opened, CI green, a task woken, a schedule, a task's message)
  and the orchestrator's reply fold into one line: an icon, the task, how the
  reply starts, the time. Tap to read the whole reply; runs of them group as
  "5 updates". What you typed, and the replies to it, stay whole, and so do
  your own decisions and any turn waiting on an approval or showing a plan or
  an error. Where a message came from is recorded when it is delivered;
  older messages are told apart by their opening text only.
  A **Needs you** strip above the composer lists everything waiting on you
  until it is resolved: open asks (escalated gates and brakes too), questions
  the orchestrator put to you in chat, its chat waiting on an approval, and
  tasks that need you. Each is one line that jumps to the ask, the message or
  the session, with a count when collapsed. The orchestrator marks a chat
  question with `question` (the same words while open are the same
  question) and clears it with `resolve_question`; the strip's Reply quotes
  it into the composer and resolves it when you send. Dismissing an item
  hides it on all your devices and resolves nothing: an ask stays open on
  its list and in the counts. Questions about a task clear when it is merged
  or dropped.
- **Proof it's you:** only this machine, the tailnet, or a paired device you
  switched to "Can approve" in Devices may answer asks or pause. Approving a
  hard line, a gate, a brake or a new passkey, Resume, changing the
  orchestrator's standing rules, and switching merge approvals off, also
  need a
  passkey (Touch ID or Face ID, user verification required) on a challenge
  bound to that one ask at its current commit or brake: single use, two
  minutes. Agents on this machine reach every route but can't make your
  authenticator sign, and neither `aos` nor the orchestrator's tools can
  answer or resume. Passkeys belong to the host they were made on
  (localhost or the tailnet's https name), so add one on
  each in Devices. The first one on an install is trusted on first use,
  once: every later one needs a code from a device that has one, even after
  every passkey is revoked. Revoking always needs a passkey, the last one
  included, and every add or revoke becomes an ask (declining a new one
  revokes it, with your passkey). If none is left, run `agent-os passkeys
reset` yourself in a terminal on the machine: it refuses inside an
  AgentOS session or an agent's shell, asks you to type a confirmation, and
  makes the next passkey first-use again. Browsers offer passkeys only over
  https or on localhost.
- **Header line and Pause:** its row reads like "Orchestrator · 3 running ·
  1 in review · 1 ask" from live data, and tapping it opens the chat, where
  the same line carries Pause/Resume. While paused it acts on nothing:
  events queue, acting tools refuse, and its stack starts and lands hold.
  It can still read, note and ask. Resume delivers what queued, folded.
- **Away mode:** turn it on when you step away, from the coffee cup in the
  sidebar header or ⌘K ("Away for 4 hours"), for 1 hour, 4 hours, until
  morning (8 AM) or until you're back. It's kept in `away_periods` (who set
  it, when, when it ends), the cup turns amber while it's on (with an amber dot on the phone's menu button), and it
  ends on its own at its time. It works only through orchestrators that
  had a real turn (yours or theirs, not an AgentOS event or a status poll)
  in the last hour, set in Settings → Workspaces → Away mode; the rest
  aren't told or woken. Each active orchestrator gets an event, and a line
  leading its digest, saying you're away and to follow work through rather
  than only react. Every 10 minutes a sweep, written as code with no model
  scanning, runs a review again when a PR is green and settled but its
  review never started or was lost (once seen on two sweeps, so the
  orchestrator had its turn), checks after each merge whether the project's
  `deploy` went live and the server came back, and sends the orchestrator
  one digest of what's new: tasks quiet 30 minutes with no PR (or failing
  CI), idle tasks with uncommitted work and no PR, and your own sessions
  idle with uncommitted work. Only sessions with a real turn inside the
  window are listed, never stopped, finished or archived ones, and nothing
  goes out when nothing changed. The sweep messages no session itself: the
  orchestrator decides what needs work, and asks one of your sessions at
  most once to wrap up. Away's own messages don't count as activity. Paused
  workspaces aren't swept. Hard lines still become asks, and while you're
  away the asks raised, failed deploys and any `aos notify` an orchestrator
  sends reach your phone as one message per sweep. Turning it off (or its running out) builds "While you were
  away" from the database, for the workspaces Away reached: what merged and
  deployed with PR links, what the sweep flagged that's still in flight and
  which gate or blocker holds it, what failed, was dropped
  or was escalated, and what waits on you (an explicit "none"). It opens on
  whichever device is open until you dismiss it, a short summary goes to
  your phone, and the report stays in Settings → Audits (`away/`).
