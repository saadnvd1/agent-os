import { getAllProjects } from "../projects";
import {
  DEFAULT_SWEEP_DAYS,
  globalSweepDays,
  projectSweepOverrides,
  reaperArmed,
} from "./settings";
import { recentRuns } from "./store";
import type { SweepRun } from "./types";

export interface SweepState {
  // Null when no number is set globally: the default applies.
  days: number | null;
  defaultDays: number;
  overrides: Array<{ projectId: string; name: string; days: number }>;
  runs: SweepRun[];
  // Whether the full clean-up (test leftovers, task databases, spares, temp
  // folders, build caches) removes anything on this machine.
  armed: boolean;
}

export function sweepState(): SweepState {
  const names = new Map(getAllProjects().map((p) => [p.id, p.name]));
  return {
    days: globalSweepDays(),
    defaultDays: DEFAULT_SWEEP_DAYS,
    overrides: projectSweepOverrides().flatMap((o) =>
      names.has(o.projectId)
        ? [
            {
              projectId: o.projectId,
              name: names.get(o.projectId)!,
              days: o.days,
            },
          ]
        : []
    ),
    runs: recentRuns(),
    armed: reaperArmed(),
  };
}
