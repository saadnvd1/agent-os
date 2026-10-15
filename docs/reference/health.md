# Health watcher

Problems are caught by the system, not found by accident. Two parts:

**Detectors** (`lib/health/detectors.ts`) are plain checks on the orchestrator watcher's tick. They cost no tokens. A trip is stored once per check and subject in `health_anomalies`; a persisting anomaly doesn't re-trip, and one that clears for 5 minutes closes.

| Check         | Trips when                                                                  |
| ------------- | --------------------------------------------------------------------------- |
| load-red      | the machine's load gate has been red 10+ minutes                            |
| queue-held    | a queued task has been held 60+ minutes                                     |
| bg-quiet      | a live background job has printed nothing for 20+ minutes                   |
| restarts      | more than 2 server boots in an hour                                         |
| ci-slow       | CI is pending past its usual time (twice the median, or p90 plus 5 minutes) |
| armed-stuck   | a PR has been armed 2+ hours without merging                                |
| server-errors | the server error rate is well above its baseline                            |
| piece-dup     | a plan piece is about to start though matching work has merged              |

All thresholds are in Settings → Health → Thresholds (`health.*` settings).

**Watchers** (`lib/health/watchers.ts`) judge a trip. Each wake is one tool-less call on the `watch` model role (Sonnet by default) with the anomaly, a bounded evidence pack, and the notes for its area; it may ask for one probe from a short local menu. The verdict (real or not, cause, suggested action, whether only you can clear it) is stored on the row. A usage brake skips wakes when the account's window is nearly spent; the row is then kept as "unjudged".

**Where you hear.** One line in the orchestrator chat (machine-wide anomalies go to every orchestrator). A phone push only when the verdict says only you can clear it, once per anomaly and at most 5 a day. The sidebar dot shows while anything is open.

**Report only.** Nothing is paused, stopped or restarted automatically.

Notes (Settings → Health → Notes) tell the watchers what normal looks like; they are kept in the database. Rows are never deleted. Dismissing an anomaly mutes that check and subject for 24 hours.
