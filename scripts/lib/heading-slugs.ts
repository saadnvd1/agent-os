/** GitHub's anchor for a heading. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/[^\w\- ]/g, "")
    .replace(/ /g, "-");
}

/** Every heading anchor in a markdown file, numbering repeats like GitHub does. */
export function headingSlugs(text: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    const m = !fence && /^#+ (.*)$/.exec(line);
    if (!m) continue;
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}
