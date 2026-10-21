# Health watcher

Problems are caught by the system, not found by accident. Two parts:

**Detectors** (`lib/health/detectors.ts`) are plain checks on the orchestrator watcher's tick. They cost no tokens. A trip is stored once per check and subject in `health_anomalies`; a persisting anomaly doesn't re-trip, and one that clears for 5 minutes closes.

| Check         | Trips when                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------- |
| load-red      | the machine's load gate has been red 10+ minutes                                                   |
| queue-held    | a queued task has been held 60+ minutes                                                            |
| bg-quiet      | a live background job has printed nothing for 20+ minutes                                          |
| bg-spin       | a background job's shell has held 80%+ of a core for 4+ minutes with no new output: stopped by PID |
| port-wait     | a session's shell loop has waited 10+ minutes on a port someone else holds: the agent is told      |
| restarts      | more than 2 server boots in an hour                                                                |
| ci-slow       | CI is pending past its usual time (twice the median, or p90 plus 5 minutes)                        |
| armed-stuck   | a PR has been armed 2+ hours without merging                                                       |
| server-errors | the server error rate is well above its baseline                                                   |
| piece-dup     | a plan piece is about to start though matching work has merged                                     |

All thresholds are in Settings → Health → Thresholds (`health.*` settings).

**Watchers** (`lib/health/watchers.ts`) judge a trip. Each wake is one tool-less call on the `watch` model role (Sonnet by default) with the anomaly, a bounded evidence pack, and the notes for its area; it may ask for one probe from a short local menu. The verdict (real or not, cause, suggested action, whether only you can clear it) is stored on the row. A usage brake skips wakes when the account's window is nearly spent; the row is then kept as "unjudged".

**Where you hear.** One line in the orchestrator chat (machine-wide anomalies go to every orchestrator). A phone push only when the verdict says only you can clear it, once per anomaly and at most 5 a day. The sidebar dot shows while anything is open.

**Report only, except one.** Nothing is paused, stopped or restarted automatically, apart from `bg-spin`: a background job whose shell spins (a wait loop that can never exit) is stopped, because it can only burn a core. `lib/health/spin.ts` decides from the CPU of shells in the job's process tree, so a silent heavy build (its CPU is in node or cc, not the shell) or a job that keeps printing is never touched; a sleeping loop stays on `bg-quiet`. `lib/health/spin-tick.ts` stops exactly that job: SIGTERM, then SIGKILL for what is still the same process, to each PID of its own tree, never by pattern or group, and only when the job is a shell directly under the agent with no AgentOS, tmux or agent in it. Every kill is logged (`[health] bg-spin`), kept as a closed anomaly, sent to the task as its next prompt (with the brief's wait advice) and to its orchestrator as one event. Its thresholds are constants in `spin.ts`, not settings.

**port-wait tells, it doesn't stop.** A sleeping `until curl localhost:3000 …; do sleep 5; done` costs nothing, so `bg-spin` never sees it, and it can't end when another process holds the port. `lib/health/port-wait-tick.ts` reads `ps` args once a minute (nothing more when no loop waits on a port), gives each wait loop to its session by its cwd in the worktree or by the session's tmux pane, so terminal sessions count as well as chats, and asks who holds the port (`lib/ports/whoHolds.ts`: another session, the Dev Servers panel, a Windows process under WSL 2, or a process outside AgentOS). When it isn't the session itself, the agent gets one message naming the holder, its own job's PID and `aos port`, and its orchestrator one event; a new holder tells it again. It's kept as a closed anomaly. Each machine judges its own sessions, since ports only meet inside one machine. The environment-failure class `port-in-use` (`EADDRINUSE`, `Port 3000 is already in use`, Docker's `port is already allocated`) sends the same advice the moment a server fails to start.

Notes (Settings → Health → Notes) tell the watchers what normal looks like; they are kept in the database. Rows are never deleted. Dismissing an anomaly mutes that check and subject for 24 hours.
