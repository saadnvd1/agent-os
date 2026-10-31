// Two-key sequences (g then i). The matcher is fed every plain key press; it
// says whether the key started a sequence, finished one, or is nobody's.

export const SEQUENCE_MS = 1500;

/**
 * The key a bare shortcut sees, or null. The hints print letters in
 * capitals, so Shift+G counts as g; other shifted keys are nobody's but "?".
 */
export function plainKey(key: string, shift: boolean): string | null {
  if (key === "?" || /^[a-z]$/i.test(key)) return key.toLowerCase();
  return shift ? null : key;
}

export type SequenceStep =
  | { kind: "none" }
  | { kind: "pending"; first: string }
  | { kind: "match"; id: string };

export class SequenceMatcher {
  private first: string | null = null;
  private at = 0;
  private starts: Set<string>;
  private pairs: Map<string, string>;

  /** `sequences` maps "g i" to the id it runs. */
  constructor(
    sequences: Record<string, string>,
    private now: () => number = Date.now
  ) {
    this.pairs = new Map(
      Object.entries(sequences).map(([k, id]) => [k.toLowerCase(), id])
    );
    this.starts = new Set([...this.pairs.keys()].map((k) => k.split(" ")[0]));
  }

  /** A key was pressed with no modifier but maybe shift. */
  feed(key: string): SequenceStep {
    const k = key.toLowerCase();
    if (this.first !== null && this.now() - this.at <= SEQUENCE_MS) {
      const id = this.pairs.get(`${this.first} ${k}`);
      this.first = null;
      if (id) return { kind: "match", id };
    }
    this.first = null;
    if (this.starts.has(k)) {
      this.first = k;
      this.at = this.now();
      return { kind: "pending", first: k };
    }
    return { kind: "none" };
  }

  /** Whether the first key of a sequence is waiting for its second. */
  pending(): string | null {
    return this.first !== null && this.now() - this.at <= SEQUENCE_MS
      ? this.first
      : null;
  }

  reset(): void {
    this.first = null;
  }
}
