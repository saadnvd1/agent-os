import type { NoteDoc } from "./types";

interface Node {
  type?: string;
  text?: string;
  content?: Node[];
}

// Anything but text-less paragraphs counts: a rule, an empty task, a heading.
const hasContent = (n: Node): boolean =>
  n.type === "text"
    ? !!n.text?.trim()
    : n.type !== "paragraph" || (n.content ?? []).some(hasContent);

/** Whether a note has nothing in it, so its button shows no dot. */
export const noteIsEmpty = (doc: NoteDoc | null | undefined): boolean =>
  !doc || !((doc.content ?? []) as Node[]).some(hasContent);
