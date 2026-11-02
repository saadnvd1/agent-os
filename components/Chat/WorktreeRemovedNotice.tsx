"use client";

import { useSessionsQuery } from "@/data/sessions";
import { Notice } from "@/components/ui/notice";

// Above the composer once a finished task's worktree is removed: its chat
// still answers from the project's checkout, but can't change anything.
export function WorktreeRemovedNotice({ sessionId }: { sessionId: string }) {
  const { data } = useSessionsQuery();
  const session = data?.sessions.find((s) => s.id === sessionId);
  if (!session?.worktree_removed) return null;
  return (
    <Notice className="mb-2">
      Merged · worktree removed. Questions work; changes need a new task.
    </Notice>
  );
}
