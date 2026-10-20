// How alike two one-line goals read: the share of content words they have
// in common. Words every task title has (add, fix, update) carry nothing.

const STOP = new Set(
  "a an and the to of for in on at with from by or as is are be it its this that into via add adds added fix fixes fixed update updates make makes use using new support improve implement allow when not no all use".split(
    " "
  )
);

const stem = (w: string) =>
  w.length > 5 && w.endsWith("ing")
    ? w.slice(0, -3)
    : w.length > 3 && w.endsWith("s") && !w.endsWith("ss")
      ? w.slice(0, -1)
      : w;

export function goalWords(goal: string): Set<string> {
  return new Set(
    goal
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map(stem)
  );
}

export function goalSimilarity(
  a: string,
  b: string
): {
  score: number;
  shared: number;
} {
  const x = goalWords(a);
  const y = goalWords(b);
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  const union = x.size + y.size - shared;
  return { score: union ? shared / union : 0, shared };
}

export const goalsAlike = (a: string, b: string) => {
  const { score, shared } = goalSimilarity(a, b);
  return score >= 0.5 && shared >= 2;
};
