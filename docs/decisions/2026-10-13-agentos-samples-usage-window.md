# AgentOS samples the usage window itself

**Decision.** The 5-hour and weekly usage windows are read from the rate-limit
events AgentOS's own agents already receive, stored in `rate_limit_readings`.
`readUsage` takes the fresher of that store and the terminal statusline's
limits.json, and never mixes their samples.

**Context.** The only writer of limits.json is the terminal statusline, so
with no terminal session open the Usage screen read "Not available" and the
brakes refused every start, while AgentOS's own sessions used the account.
The table already existed but stayed empty: the parser read only the event's
top-level reading, which the CLI sends only when a threshold is crossed. Each
event's `unifiedWindows` carries both windows every time. The field is marked
internal in the SDK types, so it is parsed defensively (missing means no
reading) and no extra request or credential is involved.

**Stale windows.** With AgentOS as a sampler, "refuse everything after 15
quiet minutes" deadlocks: a queued start is what would take the next sample.
An unknown window now refuses only when nothing was ever sampled, or the last
value was 90% or more and its window hasn't reset. Anything else goes ahead,
and the started agent samples again.

**Alternatives.** A file under ~/.agent-os (a second store with the same data
as the table); calling the plan usage endpoint on every read (spends a request
and a CLI start per screen load); keeping the strict brake (idle means stuck).

**Consequences.** A steady value refreshes the last row's time every minute,
so the newest row means "last seen at this value". The API's window view gains
optional `stale`, `sampledAt` and `ageSec`; older clients ignore them.
