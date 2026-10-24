# An analyst chat reviews a coding chat's turns; you send its prompt

Date: 2026-10-21

## Decision

Any local chat can be paired with an **analyst**: a second Claude chat in the
same folder, started in the Analyst role (its `analyze` model, Opus unless
Settings → Models says otherwise) and the coder's crew. A pairing is a row in
`analyst_links`; each review is a row in `analyst_recommendations`.

- **Pushed, not pulled.** When the coding agent finishes a turn, the server
  builds a digest of the turns since the last review (its messages, tool calls,
  diffs, and check output, capped at 16k characters, oldest turns dropped
  first, wrapped as untrusted and redacted) and queues it to the analyst. The
  cursor (`reviewed_through`) moves only when the analyst answers that digest,
  so a restart re-sends exactly what was unanswered.
- **Manual handoff.** The analyst ends each reply with a fenced
  `agentos-review` JSON block (verdict, summary, issues, prompt). The chat
  draws it as a card with Send to Coding Agent, Edit and Dismiss. Nothing
  reaches the coding agent until you press Send. A newer review supersedes an
  older open card, so only one is ever actionable. A blocked or needs-you
  verdict has no Send. A review that can't be parsed offers Ask again.
- **Side by side.** On a desktop the analyst opens in a pane to the right of
  the coder. On a phone a Coding agent | Analyst switch sits under the tab bar,
  with a dot while a prompt waits.
- Start one from a chat's ⋯ menu, the pane menu, the role pill's Add Analyst,
  or the With analyst chip on a new chat.

- **Any model, 2026-10-24.** The analyst runs on Claude unless a model is
  picked for it: any model the server lists that can call tools, including
  Pi's and other providers'. See docs/guides/local-models.md.

## Why not the orchestrator or the review step

The orchestrator supervises many tasks for a workspace and decides merges. The
review step judges a finished PR. The analyst is for one live conversation: it
explains each turn in plain English and drafts the next prompt while you are
still steering. It reuses the role, crew and model routing from agent roles,
the chat queue for delivery, and the change triggers for pushes.

## Parked

The automatic supervisor loop (send without a click, with stop conditions),
terminal coders, coders on a linked machine, an `aos analyst` CLI, swiping
between sides, and one analyst over several coders. See ideas.md.

## API

`POST /api/analyst`, `GET|PATCH|DELETE /api/analyst/:id`,
`POST /api/analyst/:id/review`,
`POST /api/analyst/:id/recommendations/:recId/{send,dismiss,again}`,
`GET /api/sessions/:id/analyst`.
