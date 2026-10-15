import type { LoadView } from "@/lib/load/monitor";

export type DotLevel = "green" | "amber" | "red";
export interface HealthCount {
  open: number;
  needsYou: number;
}

export interface StatusDot {
  level: DotLevel;
  label: string;
  title: string;
  healthLine: string | null;
  opensHealth: boolean;
}

const WORD: Record<LoadView["level"], string> = {
  green: "normal",
  amber: "busy",
  red: "high",
};

// "Load 4.2 on 10 cores · memory normal"
export function loadSummary(load: LoadView): string {
  const memory = load.pressure ?? `${load.memUsedPct}% used`;
  return `Load ${load.load1} on ${load.cores} cores · memory ${memory}`;
}

export function healthLine(h: HealthCount | undefined): string | null {
  if (!h) return null;
  if (h.needsYou > 0)
    return `${h.needsYou} health issue${h.needsYou === 1 ? " needs" : "s need"} you`;
  if (h.open > 0)
    return `${h.open} health issue${h.open === 1 ? "" : "s"} open`;
  return null;
}

// One dot for the machine load and the health watch: the worse of the two.
export function statusDot(
  load: LoadView | null,
  health: HealthCount | undefined
): StatusDot | null {
  const line = healthLine(health);
  if (!load && !line) return null;
  const level: DotLevel =
    load?.level === "red" || (health?.needsYou ?? 0) > 0
      ? "red"
      : load?.level === "amber" || (health?.open ?? 0) > 0
        ? "amber"
        : "green";
  const join = (parts: (string | null)[]) => parts.filter(Boolean).join(" · ");
  return {
    level,
    label: join([load ? `Load ${WORD[load.level]}` : null, line]),
    title: join([load ? loadSummary(load) : null, line]),
    healthLine: line,
    opensHealth: (health?.open ?? 0) > 0,
  };
}
