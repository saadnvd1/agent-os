/**
 * What the page remembers of the history entries it made, for the menu behind
 * the back button: the browser won't list its own history. Entries are keyed
 * by the `index` also kept in each entry's state, so a reload or a back
 * button still finds its place.
 */
export interface MirrorEntry {
  index: number;
  sessionId: string;
  name: string;
}

export interface Mirror {
  entries: MirrorEntry[];
  current: number;
}

export const MAX_MIRROR = 100;

export const emptyMirror = (): Mirror => ({ entries: [], current: -1 });

/** Standing on an entry that is new (a push) or known (replace or reload):
 * a push drops the forward entries, as the browser does. */
export function visit(
  m: Mirror,
  entry: MirrorEntry,
  how: "push" | "replace"
): Mirror {
  const kept =
    how === "push"
      ? m.entries.filter((e) => e.index < entry.index)
      : m.entries.filter((e) => e.index !== entry.index);
  const entries = [...kept, entry]
    .sort((a, b) => a.index - b.index)
    .slice(-MAX_MIRROR);
  return { entries, current: entry.index };
}

/** Back or forward landed on the entry with this index. */
export const moveTo = (m: Mirror, index: number): Mirror =>
  m.entries.some((e) => e.index === index) ? { ...m, current: index } : m;

export const earlier = (m: Mirror): MirrorEntry[] =>
  m.entries.filter((e) => e.index < m.current).reverse();

export const later = (m: Mirror): MirrorEntry[] =>
  m.entries.filter((e) => e.index > m.current);

/** A renamed chat reads under its new name in the menu. */
export const renameIn = (
  m: Mirror,
  sessionId: string,
  name: string
): Mirror => ({
  ...m,
  entries: m.entries.map((e) =>
    e.sessionId === sessionId ? { ...e, name } : e
  ),
});
