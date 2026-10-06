// The workspace header line, e.g. "Orchestrator · 3 running · 1 in review ·
// 1 ask", and how much a row adds to "N need you". Client-safe: no database.

export interface HeaderCounts {
  running: number;
  inReview: number;
  asks: number;
  paused: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export function headerParts(c: HeaderCounts): string[] {
  const parts = [
    c.paused && "paused",
    c.running > 0 && `${c.running} running`,
    c.inReview > 0 && `${c.inReview} in review`,
    c.asks > 0 && plural(c.asks, "ask"),
  ].filter((p): p is string => !!p);
  return parts.length ? parts : ["all quiet"];
}

export const headerLine = (c: HeaderCounts) =>
  ["Orchestrator", ...headerParts(c)].join(" · ");

// A waiting session needs you once; an orchestrator once per open ask.
export function needCount(
  status: { status: string; asks?: number } | undefined
): number {
  if (status?.status !== "waiting") return 0;
  return Math.max(1, status.asks ?? 0);
}
