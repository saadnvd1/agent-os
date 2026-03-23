# Agent-OS Feature Investigation

> Researched 2026-03-22. Based on competitive analysis of Warp, Emdash, Claude Squad, Intent (Augment), Cursor, Windsurf, Codex, and emerging patterns in the AI agent management space.

## Legend
- **Impact**: H (high) / M (medium) / L (low) — estimated user value
- **Effort**: S (small) / M (medium) / L (large) — estimated implementation effort
- Items already in `ideas.md` are marked with *(existing)*

---

## 1. Cost & Usage Monitoring

Agent-OS currently has zero visibility into token/cost usage. This is one of the most requested features across the ecosystem.

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| Token usage tracking per session | H | M | Parse Claude Code's `--output-format stream-json` for token counts. Display in session header. |
| Cost estimation dashboard | H | M | Aggregate token usage → estimated cost by model. Daily/weekly/monthly views. |
| Burn rate indicator | M | S | Real-time tokens/min during active sessions. Simple badge on session card. |
| Budget alerts | M | M | Set daily/monthly spending caps. Notify when approaching limits. |
| Per-model cost comparison | L | S | Show cost difference if session had used a different model. |

**Why this matters:** Power users running parallel agents can burn through significant API costs without realizing it. No competing self-hosted tool does this well yet — big differentiator opportunity.

---

## 2. Multi-Agent Orchestration Upgrades

Agent-OS already has conductor/worker orchestration. These features would make it best-in-class.

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| Best-of-N evaluation | H | L | Run same prompt on N agents, diff the results, pick the best. Emdash has this. |
| Side-by-side diff comparison | H | M | Compare outputs/changes across parallel agent sessions. |
| Agent team presets | M | M | Pre-defined team configs (e.g., "frontend + backend + tests") that spin up multiple coordinated sessions. |
| Cross-repo orchestration | M | L | Conductor assigns tasks across different repositories, not just worktrees. |
| Inter-agent messaging | M | L | Workers can send status/questions to conductor without user relay. Extend MCP server. |

---

## 3. Notifications & Alerts

*(partially existing in ideas.md)*

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| Push notifications (mobile) | H | M | Web Push API. Alert when session needs input, errors out, or completes. Critical for mobile-first. |
| Desktop notifications | H | S | `Notification` API for browser, already built into web platform. |
| Sound alerts | M | S | Configurable audio cue when session state changes. |
| Slack/Discord webhook | M | M | Post session status updates to a channel. |
| Email digest | L | M | Daily summary of session activity, costs, and completed work. |

**Why this matters:** Mobile-first users walk away from their screen. Without notifications, they have to keep checking back.

---

## 4. Session Intelligence

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| Session activity timeline | H | M | Visual timeline showing what each session did and when (commits, tool calls, idle periods). |
| Auto-generated session summaries | H | M | When a session completes, generate a 2-3 sentence summary of what was accomplished. |
| Session search across conversations | M | M | Full-text search across all message history. *(existing idea)* |
| Session tagging | M | S | User-defined tags for organizing and filtering sessions. |
| Session duration & efficiency metrics | M | S | Time active vs idle, tool calls per session, tokens per commit. |
| Conversation export | M | S | Markdown/JSON export. *(existing idea)* |

---

## 5. Developer Productivity Dashboard

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| Daily commit heatmap | M | M | GitHub-style contribution graph showing agent-assisted commits. |
| PR cycle time tracking | M | M | Time from session start → PR merged. Track across sessions. |
| Agent productivity comparison | M | M | Which agent provider produces the best results for your codebase. |
| Project health overview | M | M | At-a-glance view: open PRs, active sessions, failing tests, running dev servers. |
| Weekly activity report | L | M | Auto-generated markdown report of the week's agent-assisted work. |

---

## 6. Enhanced Terminal & UI

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| Command palette (Cmd+K) | H | M | App-wide action search: switch sessions, run commands, search code, open files. |
| Vim keybindings in terminal | M | S | xterm.js addon for vim-style navigation in terminal output. |
| Terminal output blocks | M | L | Warp-style grouping of command input/output into navigable blocks. |
| Custom themes | M | M | Theme editor or preset themes beyond dark/light. *(extends existing idea)* |
| Picture-in-picture mode | M | M | Detach a session into a floating mini-terminal while browsing others. |
| Split terminal within session | M | M | Multiple terminal panes within a single session (not just multi-session panes). |

---

## 7. Context & Memory Management

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| CLAUDE.md editor | H | S | Edit project CLAUDE.md files directly from the UI. Huge for mobile users. |
| Session memory/notes | M | S | Per-session scratch notes that persist. Quick way to jot context for later. |
| Codebase context viewer | M | M | Show what files/context the agent has read in the current session. Transparency into context window. |
| Context window usage bar | M | S | Visual indicator of how full the agent's context window is. |
| Shared project knowledge base | L | L | Project-level knowledge that auto-injects into all sessions for that project. |

---

## 8. CI/CD & Testing Integration

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| GitHub Actions status | H | M | Show CI check status for branches/PRs created by agent sessions. |
| Test runner integration | H | M | Run tests from UI, show results inline. One-click "run tests" button per session. |
| Deploy trigger | M | M | Trigger deployment from session UI after PR merge. |
| Build log viewer | M | M | Stream CI/CD logs within agent-os instead of switching to GitHub. |
| PR review status | M | S | Show review state (approved, changes requested) for agent-created PRs. |

---

## 9. Security & Access Control

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| Auth system (basic) | H | M | Password or token-based auth. Currently open if network-accessible. |
| Secret redaction in terminal | M | M | Auto-detect and mask API keys, tokens in terminal output. |
| Session-level permissions | M | L | Restrict what directories/commands a session can access. |
| Audit log | M | M | Log all actions taken by agents for compliance/review. |
| 2FA / biometric auth | L | L | For mobile access via Tailscale. |

---

## 10. Remote Execution & Portability

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| Session teleportation | H | M | Pause session on one device, resume on another with full context. Uses `--resume`. |
| Remote VM session launch | M | M | Start agent sessions on remote machines from the UI (like cc-remote but built-in). |
| Session sharing via URL | M | M | Generate shareable link to view (read-only) a session's progress. |
| Multi-machine session dashboard | M | L | See sessions across multiple agent-os instances in one view. |

---

## 11. Issue Tracker Integration

| Feature | Impact | Effort | Notes |
|---------|--------|--------|-------|
| GitHub Issues sync | H | M | Pull issues, auto-create sessions from issues, link sessions to issues. |
| Linear integration | M | M | Sync tickets, update status when PR is created. |
| Jira integration | M | L | For enterprise users. |
| Auto-link sessions to issues | M | S | Parse issue numbers from branch names or prompts, link automatically. |

---

## Top 10 Recommendations (Prioritized)

These are the highest-impact features that would differentiate agent-os the most, considering current competitive landscape and the product's mobile-first positioning:

1. **Push notifications** (mobile + desktop) — critical for mobile-first UX
2. **Token usage + cost tracking dashboard** — no self-hosted tool does this well
3. **CLAUDE.md editor in UI** — huge mobile usability win, trivial to build
4. **Auto-generated session summaries** — know what happened without reading logs
5. **GitHub Actions CI status** — close the loop on agent-created PRs
6. **Best-of-N agent evaluation** — unique orchestration feature
7. **Command palette** — power-user productivity, expected in modern tools
8. **Basic auth system** — security baseline for any self-hosted tool
9. **GitHub Issues integration** — issue → session → PR → merge pipeline
10. **Session activity timeline** — visual understanding of agent work patterns

---

## Competitive Gaps (What Others Have That Agent-OS Doesn't)

| Feature | Who Has It | Priority |
|---------|-----------|----------|
| Cost/token tracking | OpenCode Monitor, Langfuse | High |
| Push notifications | None (opportunity!) | High |
| CI/CD status in UI | Emdash | High |
| Issue tracker integration | Emdash (Linear, Jira, GitHub) | High |
| Best-of-N evaluation | Emdash | Medium |
| Built-in browser preview | Intent | Medium |
| Kanban board view | Emdash | Medium |
| Session sharing | Warp | Medium |
| Secret redaction | Warp | Medium |
| Visual code verification | Warp Oz | Low |

---

## Quick Wins (High Impact, Small Effort)

These can be shipped fast:

1. **CLAUDE.md editor** — file read/write API already exists
2. **Desktop notifications** — browser `Notification` API, ~50 lines
3. **Sound alerts** — `Audio` API, configurable per event
4. **Context window usage bar** — parse token info from stream-json
5. **Session tagging** — add `tags` column to sessions table
6. **Session notes** — add `notes` column, simple textarea in UI
7. **Auto-link sessions to issues** — regex parse branch names
