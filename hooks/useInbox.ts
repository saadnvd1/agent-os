"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSnapshot } from "valtio";
import { useSessionsQuery } from "@/data/sessions/queries";
import { fetchStatuses } from "@/data/statuses/queries";
import { statusKeys } from "@/data/sessions/keys";
import { useOrchestratorsQuery } from "@/data/orchestrators";
import { useTasksQuery } from "@/data/tasks";
import { useBusMessages } from "@/data/bus";
import { useClock } from "@/hooks/useMinuteTick";
import { inBell } from "@/lib/sidebar/shelves";
import { needsHuman } from "@/lib/tasks/state";
import {
  inboxCounts,
  needsYouRows,
  unreadCount,
  type InboxCounts,
  type NeedsRow,
} from "@/lib/inbox/counts";
import { inboxUi, inboxUiActions } from "@/stores/inboxUi";

// Everything waiting on him, from the queries the old panels already used.
export function useInbox(): { rows: NeedsRow[]; counts: InboxCounts } {
  const now = useClock();
  const { data: sessions } = useSessionsQuery();
  const { data: statuses } = useQuery({
    queryKey: statusKeys.all,
    queryFn: fetchStatuses,
    staleTime: 2000,
  });
  const { data: overviews } = useOrchestratorsQuery();
  const { data: tasks } = useTasksQuery();
  const { data: messages } = useBusMessages();
  const { seenMessageId } = useSnapshot(inboxUi);

  useEffect(() => {
    inboxUiActions.loadSeen();
  }, []);
  // First run: what is already there isn't new.
  useEffect(() => {
    if (!messages || inboxUi.seenMessageId !== null) return;
    inboxUiActions.markSeen(messages.reduce((n, m) => Math.max(n, m.id), 0));
  }, [messages, seenMessageId]);

  const rows = useMemo(
    () =>
      needsYouRows({
        waiting: (sessions?.sessions ?? [])
          .filter((s) => inBell(s, statuses?.statuses[s.id], now))
          .map((s) => ({ id: s.id, name: s.name })),
        overviews: overviews ?? [],
      }),
    [sessions, statuses, overviews, now]
  );
  const counts = useMemo(
    () =>
      inboxCounts({
        rows,
        tasksNeedingYou: (tasks ?? [])
          .filter((t) => needsHuman(t.state))
          .map((t) => t.id),
        unread: unreadCount(messages ?? [], seenMessageId),
      }),
    [rows, tasks, messages, seenMessageId]
  );
  return { rows, counts };
}
