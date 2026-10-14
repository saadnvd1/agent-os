// The plan badge a row shows: writing its plan, or a plan
// waiting for approval. A need or a stall says more and wins; finished,
// snoozed and quick-change rows show none. Client-safe.
import { NEED_LABEL, type SidebarRow } from "./shelves";

export type RowKindBadge = {
  kind: "planning" | "plan-ready";
  label: string;
  // What it means and what to do: the badge's hover text.
  tip: string;
};

export function rowKindBadge(
  row: Pick<SidebarRow, "need" | "task" | "settled" | "wakesAt"> & {
    session: SidebarRow["session"];
    status?: SidebarRow["status"];
  }
): RowKindBadge | null {
  const s = row.session;
  if (row.need || row.status?.stalled) return null;
  if (row.settled || row.wakesAt || s.quick_of || s.role) return null;
  if (s.task_status && s.task_status !== "running") return null;
  if (row.task === "plan-ready" || s.plan_phase === "awaiting")
    return {
      kind: "plan-ready",
      label: "Plan ready",
      tip: "Plan ready: waiting for your approval. Open it to read the plan.",
    };
  if (s.plan_phase === "planning" || (!s.plan_phase && !!Number(s.chat_plan)))
    return {
      kind: "planning",
      label: "Planning",
      tip: s.plan_only
        ? "Planning: plan only, it stops at the plan for your approval."
        : s.plan_phase
          ? "Planning: writing its plan, then it implements."
          : "Plan mode: it plans and changes nothing yet.",
    };
  return null;
}

// The one status badge a row's second line carries: what it needs from you,
// stalled, or its plan step. They are mutually exclusive by precedence. The
// queued rows' Failed/Starting use the same shape.
export type StatusBadge = {
  kind: "need" | "failed" | "stalled" | "starting" | RowKindBadge["kind"];
  label: string;
  tip?: string;
};

export function rowStatusBadge(
  row: Parameters<typeof rowKindBadge>[0] &
    Pick<SidebarRow, "need"> & { status?: SidebarRow["status"] }
): StatusBadge | null {
  if (row.need) {
    const asks = row.status?.asks ?? 0;
    return {
      kind: row.need === "failed" ? "failed" : "need",
      label: `${NEED_LABEL[row.need]}${asks > 1 ? ` ${asks}` : ""}`,
    };
  }
  if (row.status?.stalled) return { kind: "stalled", label: "Stalled" };
  return rowKindBadge(row);
}
