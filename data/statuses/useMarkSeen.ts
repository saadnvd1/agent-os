import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionStatus } from "@/components/views/types";
import { statusKeys } from "../sessions/keys";

// The session on screen is seen: when you open it, when you come back to
// the tab, and when it finishes something while you're looking.
export function useMarkSeen(
  activeSessionId: string | null | undefined,
  status: SessionStatus["status"] | undefined
) {
  const queryClient = useQueryClient();
  const waiting = status === "waiting";

  useEffect(() => {
    if (!activeSessionId) return;
    const mark = () => {
      if (document.visibilityState !== "visible") return;
      void fetch(`/api/sessions/${activeSessionId}/seen`, {
        method: "POST",
      }).then(() =>
        queryClient.invalidateQueries({ queryKey: statusKeys.all })
      );
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [activeSessionId, waiting, queryClient]);
}
