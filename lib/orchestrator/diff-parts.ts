// A diff too big to read whole, cut into parts a reviewer can: whole files
// only, in path order so an area's files stay together.

// Each file's section of a `git diff`, in order.
export function fileSections(diff: string): string[] {
  return diff.split(/^(?=diff --git )/m).filter((s) => s.length);
}

// The parts, each at most `cap` characters; null when one file alone is
// bigger than that or it would take more than `maxParts`.
export function diffParts(
  diff: string,
  cap: number,
  maxParts: number
): string[] | null {
  const parts: string[] = [];
  let current = "";
  for (const section of fileSections(diff)) {
    if (section.length > cap) return null;
    if (current.length + section.length > cap) {
      parts.push(current);
      current = "";
    }
    current += section;
  }
  if (current) parts.push(current);
  return parts.length <= maxParts ? parts : null;
}
