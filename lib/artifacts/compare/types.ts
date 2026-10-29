import type { ArtifactVersion } from "../actions";

export type CompareMode = "changes" | "source";

// A piece of one line: kept, or (on a removed line) taken out, or (on an
// added line) put in.
export interface WordPart {
  t: "eq" | "add" | "del";
  s: string;
}

export interface DiffLine {
  t: "eq" | "add" | "del";
  s: string;
  // Only on a removed or added line that pairs with one on the other side.
  words?: WordPart[];
}

export interface DiffSummary {
  added: number;
  removed: number;
}

export type Comparison =
  | {
      ok: true;
      mode: CompareMode;
      from: ArtifactVersion;
      to: ArtifactVersion;
      summary: DiffSummary;
      lines: DiffLine[];
    }
  | {
      ok: true;
      mode: CompareMode;
      from: ArtifactVersion;
      to: ArtifactVersion;
      // Too big to diff: the client shows the pages side by side only.
      tooLarge: true;
      reason: string;
    };

export type CompareResult =
  Comparison | { ok: false; status: 400 | 404; error: string };
