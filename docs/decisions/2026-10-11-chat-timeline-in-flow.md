# Chat timeline renders in the page's flow

Date: 2026-10-11

## Decision

The conversation is a plain scrolling column of rows, not a virtualized list.
Rows off screen use `content-visibility: auto` (`.chat-row`) so they cost
almost nothing to lay out or paint, and older history still arrives in pages.
Auto-scroll to the end holds off while the reader is selecting text, and
copying across two or more messages gives a transcript (`User:` / `Assistant:`
and a blank line between).

## Why

Selecting across several messages and copying them is how a conversation moves
into another session, and it failed. The virtualized list recycled a pool of
absolutely positioned slots as the reader moved, kept the DOM in a different
order from the reading order until a delayed re-sort, and re-sorted again as
output streamed in. A native selection is anchored to DOM nodes, so every one
of those collapsed or shifted it. Separately, following the end of a streaming
conversation scrolled the view under a selection in progress.

## Alternatives considered

- Keep the list and freeze it while a selection exists: the list still decides
  which nodes exist, so a selection that grows beyond the pool has nothing to
  extend over.
- A custom selection layer over the list: re-implements the browser's, badly
  on a phone.

## Consequences

- Every loaded row stays in the DOM (up to the paged history). First render of
  a long page costs more than a pooled list; `content-visibility` keeps the
  paint and layout part small.
- Revisit if a page of history measurably janks on a phone: shrink the page
  size before bringing a pooled list back.
