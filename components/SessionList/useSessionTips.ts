"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useHostNames } from "@/data/hosts";
import { registerTip } from "@/lib/hover-tip";
import { rowDetails } from "@/lib/sidebar/row-details";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import type { SidebarData } from "./useSidebarData";

function find(rows: readonly SidebarRow[], id: string): SidebarRow | null {
  for (const row of rows) {
    if (row.session.id === id) return row;
    const nested = find(row.workers, id) ?? find(row.quick ?? [], id);
    if (nested) return nested;
  }
  return null;
}

// A session row's hover tip, built from the latest list only when it
// opens: nothing runs per row, and registering never re-renders.
export function useSessionTips(data: SidebarData) {
  const hostNames = useHostNames();
  const latest = useRef({ data, hostNames });
  useLayoutEffect(() => {
    latest.current = { data, hostNames };
  });
  useEffect(
    () =>
      registerTip("session", (id) => {
        const { data, hostNames } = latest.current;
        const row = find(
          [
            ...Object.values(data.shelves).flat(),
            ...data.machines.flatMap((g) => g.rows),
          ],
          id
        );
        if (!row) return null;
        const s = row.session;
        return rowDetails(row, {
          project: data.projectNames.get(s.project_id ?? ""),
          startedBy: s.started_by
            ? data.orchestratorNames.get(s.started_by)
            : undefined,
          host:
            s.host_id && s.host_id !== "local"
              ? hostNames[s.host_id] || "remote"
              : undefined,
        });
      }),
    []
  );
}
