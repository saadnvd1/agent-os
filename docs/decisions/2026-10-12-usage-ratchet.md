# Usage ledger, weighting and the ratchet

**Decision.** Record every Claude response in `usage_calls` (per message id, with the 5m/1h cache write split and
context size), roll it up per local day with no model, and alert on a ratcheted baseline.

**Why.** Limit use has to be measured the same way every day, and cost on its own rewards doing less. The headline
is cost per clean-merged PR, so a cheaper but worse day still shows.

**Choices.**

- Per response, not per turn: only that gives the cache write split and the context size.
- Weighted tokens (API price ratios) are the unit; they are an estimate of limit use, labelled so.
- Cost per merged PR is the day's non-interactive work over the day's merges, so dropped work counts against it.
- Spans of days are ratios of sums, never a mean of daily ratios.
- A clean merge is the first reviewed head passing review and CI, with no gate failures and no later head. An
  unreviewed merge is not clean.
- The baseline is the first 7 complete days, then ratchets on the trailing 7 days; it never loosens.
- Alerts need a minimum number of merges in the window so one expensive day on a quiet week doesn't page.
- Limit windows come from the `rate_limit_event`s the CLI already sends. They carry one window at a time, so a
  stale weekly figure is refreshed by one 1-token request per nightly pass, then estimated and marked.

**Not covered.** One-shot helper runs outside the reviewer (PR text, summaries) are not recorded; they are small.
Check runs have no 5m/1h split (their result doesn't carry one) and count as 5m.
