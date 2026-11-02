// A selection being forked, and what's left of it after leaving Fork mode.
export interface ForkDraft {
  sessionId: string;
  quote: string;
  own: boolean;
  // Off after leaving Fork mode: the quote stays as a chip on a normal reply.
  mode: boolean;
}

export const FORK_PLACEHOLDER = "What should the fork do?";

// Esc or the pill's x: only the Fork pill goes; the quote chip stays when
// there is one, and what was typed stays in the composer.
export const leaveForkMode = (draft: ForkDraft): ForkDraft | null =>
  draft.quote ? { ...draft, mode: false } : null;

// The parent's guess has no place in Fork mode, which asks its own question.
export const suggestionFor = (
  suggestion: string | null,
  dismissed: string | null,
  inForkMode: boolean
): string | null =>
  inForkMode || suggestion === dismissed ? null : suggestion;

export const placeholderFor = (
  connected: boolean,
  inForkMode: boolean,
  sessionName: string
): string =>
  !connected
    ? "Reconnecting…"
    : inForkMode
      ? FORK_PLACEHOLDER
      : `Message ${sessionName}`;
