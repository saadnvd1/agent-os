/** Where a chat was last being read: the first row in view, how far down it
 * sat, and whether the reader was following the latest output. */
export interface ChatView {
  sessionId: string;
  itemId: string | null;
  offsetPx: number;
  atEnd: boolean;
  /** Epoch ms of the last time the reader had this chat open. */
  viewedAt: number;
}

export interface ChatViewInput {
  itemId: string | null;
  offsetPx: number;
  atEnd: boolean;
  /** Whether this counts as having seen everything up to now. */
  advance: boolean;
}

export const MAX_VIEWS = 500;
