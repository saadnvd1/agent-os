# Development

```bash
npm run screenshots  # regenerate screenshots/ from a demo instance with fake data
npm run dev          # http://localhost:3011
npm test             # vitest
npm run lint         # eslint
npm run check        # typecheck, lint, format and tests: what CI runs
scripts/redeploy     # pull, install, build; restarts via $AGENTOS_RESTART only if all of it worked
scripts/redeploy --rollback  # put the previous build back and restart
```

One Node process serves every terminal, chat stream and request, so a route
handler in `app/api/` may not call a `*Sync` child_process or fs function:
ESLint refuses it. Use the async form with a timeout.

Every git process starts in `lib/git-exec.ts`: `git()`, `gitResult()`,
`gitOk()` and named operations (`revParse`, `worktreeAdd`, `gitPush`, …). It
sets one timeout, kills a hung git, never lets git prompt, keeps the server's
tmux out of hooks and rejects with a `GitError` carrying the exit code and
stderr. ESLint refuses git spawned anywhere else in `lib/`, `app/` or
`server.ts`.

`scripts/redeploy` (and `scripts/autodeploy`, which calls it) builds into
`.next-build` while the live server keeps serving `.next`. The build is swapped
in by rename only once it finished with a `BUILD_ID`, right before the restart.
The build it replaced is kept in `.next-prev` for one rollback, and a failed
build leaves `.next` as it was.

`scripts/autodeploy` waits for a merge to be 2 minutes old
(`AGENTOS_SETTLE`), so a burst of merges is one build and one restart. Before
it pulls, `scripts/wait-quiet` waits for the reviews, task setups and
simulator starts the
server runs (`GET /api/busy`, loopback or tailnet only) to finish, for up to
10 minutes (`AGENTOS_QUIET_WAIT`), then deploys anyway. A review a restart
cuts off anyway runs again when the server starts, and its verdict arrives
as usual.

Restarts are also spaced `AGENTOS_MIN_GAP` seconds apart (default 600; 0 turns
it off). A merge that lands inside the gap isn't dropped: the checkout stays
as it was, and the newest head deploys on the first run after the gap ends.
Each hold logs one line, `HELD <sha> <n>s left in the <gap>s restart gap`
(once per head), so holds can be counted with `grep -c HELD`. For an urgent
fix, put `[deploy-now]` in the commit message (any commit the deploy would
take): the gap is skipped and the log says so. `scripts/autodeploy.test.ts`
runs the script against a scratch origin.

A task whose project declares `test` in `agentos.json` is told to run exactly
that command, and that CI runs the full suite; without it the brief says to
run the project's own checks.

`scripts/perf/loadtest.mjs` starts a throwaway AgentOS (its own HOME,
database, port and tmux socket) with N idle sessions and reports RSS, file
descriptors, child processes and spawns per minute; `scripts/perf/execs.mjs
--pid <pid>` counts what any server spawns, grouped by command. Both count
spawns with eslogger (macOS) or strace (Linux) and need passwordless sudo for
that one number. Run them on a machine with room to spare.

A pre-commit hook (`.husky/pre-commit`, installed by `npm install`) checks
only what is staged, in well under two seconds: `prettier --check`, failing
with the `npx prettier --write …` command that fixes it, and a scan of the
added lines for token-shaped secrets with the merge gate's own rule
(`scripts/hooks/staged-secrets.ts` reads `secretsIn` from
`lib/orchestrator/diff.ts`), naming the file and line. Build a test's fake
token at runtime (`"gh" + "p_" + "a".repeat(36)`) rather than writing it
whole. It also refuses words that must not land in this public repo
(`scripts/hooks/banned-terms.ts`): a short built-in list, plus, when it
exists, a private list of regexes kept outside the repo in
`~/.config/agent-os/banned-names` (`AGENTOS_BANNED_NAMES` overrides the
path), checked against added lines and file names; `scripts/check` runs the
same check over every tracked file. It runs in the worktrees AgentOS makes too, which have no `.husky/_`
until `npm install` runs in them. Typecheck, lint and tests are left to CI.
In an emergency, `git commit --no-verify` skips it. CI runs `scripts/check --build` on every pull request and push to main,
which also holds the app's first-load JavaScript to a budget
(`scripts/check-bundle.mjs`; `npx next experimental-analyze` shows what's in
it).

## Session audits

`/session-audit`, a Claude Code skill kept locally (gitignored, not in this
repo), audits the sessions AgentOS started (tasks, chats, orchestrators and their review
agents) for token waste and repeated manual work. Its extractor,
`scripts/session-audit/audit.ts`, streams the sessions' Claude transcripts and
AgentOS's own records (checks, notes, asks, messages) into a compact summary
in a couple of seconds: context read per turn, peak context, the biggest tool
outputs, repeated commands and errors, files re-read, polling loops, rebases,
hand-stripped trailers and dev-instance clean-ups. The skill reads only that
summary, ranks a plan by impact and effort, compares it with the last audit,
and offers to start the fixes you pick as tasks.

## Code health audits

`/code-health-audit`, also a local skill, audits this codebase for
performance, security and duplication. A script does the measuring first:
`scripts/code-health/prepass.ts` collects `npm audit` and outdated
packages, first-load bundle sizes from the last build, the largest files and
functions, copied blocks, ESLint by rule, API routes that are public or
change state without a `lib/security` guard, commands a shell parses and SQL
built from strings, secret shapes and machine details (redacted), and slow
tests from a vitest JSON, into one compact summary, and compares its numbers
with the last audit's. The skill reads that summary and the lines it points
at, writes a ranked plan (calling out work a script could do instead of a
model), and starts the fixes you pick as tasks.

Audits quote session content and name weak spots, so they stay on your
machine in `~/.agent-os/audits/<kind>/` (session audits in `sessions/`,
code health in `code-health/`;
`AGENTOS_AUDITS_DIR` moves the root) and never in a repo. Settings → Audits
(or ⌘K, "Session audits") lists every kind's markdown reports, newest first,
and renders them.
