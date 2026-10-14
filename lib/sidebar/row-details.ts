// What a session row's hover tip says: its full name, then what the row
// abbreviates. Built when the tip opens, never on render. Client-safe.
import type { TipContent } from "@/lib/hover-tip";
import { rowGroup } from "@/lib/recipes/chip";
import { compactTimeAgo } from "@/lib/session-meta";
import { prStageText } from "@/lib/tasks/pr-stage";
import { NEED_LABEL, type SidebarRow } from "./shelves";
import { pauseSubtitle } from "./paused";
import { rowKindBadge } from "./row-badge";

export function rowState(row: SidebarRow, now: number): string {
  if (row.need) return `Needs you: ${NEED_LABEL[row.need]}`;
  if (row.status?.stalled) return "Stalled";
  const badge = rowKindBadge(row);
  if (badge?.kind === "plan-ready") return "Plan ready, waiting for approval";
  if (badge?.kind === "planning")
    return row.session.plan_only ? "Planning (plan only)" : "Planning";
  if (row.paused) return pauseSubtitle(row.paused, now);
  if (row.compacting) return "Compacting its context";
  const pr = row.status?.prStage;
  if (pr) return prStageText(pr);
  if (row.working) return "Working";
  if (row.wakesAt) return "Snoozed";
  return row.settled ? "Done" : "Idle";
}

export function rowDetails(
  row: SidebarRow,
  names: {
    project?: string;
    startedBy?: string;
    host?: string;
  },
  now: number = Date.now()
): TipContent {
  const s = row.session;
  const lines: TipContent["lines"] = [["State", rowState(row, now)]];
  if (names.project) lines.push(["Project", names.project]);
  const group = rowGroup(s);
  if (group)
    lines.push([group.kind === "recipe" ? "Recipe" : "Plan", group.text]);
  if (s.pr_number) lines.push(["PR", `#${s.pr_number}`]);
  if (names.host) lines.push(["Machine", names.host]);
  if (names.startedBy) lines.push(["Started by", names.startedBy]);
  if (row.activeAt) {
    const ago = compactTimeAgo(new Date(row.activeAt), new Date(now));
    lines.push([
      "Last active",
      ago === "now" ? "just now" : /^\d+[mhd]$/.test(ago) ? `${ago} ago` : ago,
    ]);
  }
  return { title: s.name, lines };
}
