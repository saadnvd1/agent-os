/** A Tiptap document, as `editor.getJSON()` gives it. */
export interface NoteDoc {
  type: "doc";
  content?: unknown[];
}

export interface SessionNote {
  sessionId: string;
  /** null: no note written yet. */
  doc: NoteDoc | null;
  updatedAt: string | null;
}

/** The stored JSON may be at most this many bytes. */
export const MAX_NOTE_BYTES = 256 * 1024;

export class NoteError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 413
  ) {
    super(message);
  }
}
