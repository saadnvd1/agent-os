# Next-prompt suggestions that never show

**Status:** Partly ours, fixed; the rest is the Agent SDK's own rules (October 7, 2026)

## Problem

In a long-running chat (session c373fb78, Opus, 300k–950k tokens of context, many
background agents, AgentOS redeploying several times an hour), a suggestion showed
once and then not again across many turns. The worker log said nothing either way.

## What was checked

- **The SDK on its own** (Agent SDK 0.3.284, CLI 2.1.284), with a bare `query()`
  and the same options as `lib/chat/drivers/claude.ts`: suggestions arrive after
  most turns, including turns that leave a background shell running and turns
  in a process that resumed the conversation. They arrive **5–16 seconds after
  the turn ends** on Haiku with a small context. On Opus with a large context
  they take longer.
- **AgentOS end to end**, a throwaway chat on a dev server over 9 turns: 7
  suggestions reached the WebSocket and the database. In a browser, the ghost
  text showed, Tab took it, and the next turn's suggestion showed too. The UI
  (`lib/chat/suggestion.ts`, `ComposerBody`) hides one only when the composer
  has text in it or the reader dismissed that exact text.
- **The c373fb78 transcript**: no turn ended near the CLI's cache threshold
  (see below), so a cold cache wasn't why.

## Cause, ours (fixed)

A worker from before a redeploy was closed **the moment its turn went idle**
(`lib/chat/runner.ts`), killing its agent before the suggestion arrived.
c373fb78's worker was retired as stale 13 times in the server log in one day.
Now an idle stale worker waits up to two minutes for its suggestion. A message
sent in that time still goes to a fresh worker on current code, and queued
messages still retire it at once.

## Cause, the SDK's (not ours to fix)

The CLI drops a suggestion without telling the SDK client. From the CLI source:

- **A new message aborts it.** Any message that starts a turn aborts the guess
  still being made, and that includes a background task's notification. An
  orchestrator with background agents, peer messages and schedules often starts
  its next turn within seconds. Of c373fb78's 249 turns, 129 started within a
  minute of the last one ending.
- **Suppressed before generating**: fewer than two assistant messages so far,
  the last reply was an API error, plan mode, a pending permission or
  elicitation, the plan's usage limit is near (`rate_limit_event` status not
  `allowed`; `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=true` keeps them on when
  near the limit, never at it), or a cold cache (the last reply's uncached
  input + output over 10,000 tokens, or that plus its cache write over 10,000).
- **Filtered after generating**: empty, "done", "nothing to suggest", one word
  (except yes/ok/push/commit/deploy/continue and similar), over 12 words or 100
  characters, two sentences, formatting, a `Label: ` prefix, thanks or praise,
  or written as the agent ("Let me", "I'll", "Here's").
- The CLI's unused-suggestion back-off (`promptSuggestionUnusedStreak`) applies
  to the terminal UI only, not to SDK sessions.

None of these reach the client, so the UI can't say which one it was.

## Finding out next time

The worker log (`~/.agent-os/chat/<key>/<session>.log`) has one `[suggestion]`
line per turn: the suggestion and how long after the turn it came, or, when none
came, what ended the wait (a message sent, the next turn, the agent closing) and
how long after, with the facts the stream showed: first turn, failed turn, a
turn the agent started, plan mode, rate-limit status, and the last reply's token
counts. A turn whose next message came more than a minute later with nothing
else noted is one the CLI suppressed or filtered.
