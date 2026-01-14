import type { Session } from "@/lib/db";
import type { SessionStatus } from "@/components/views/types";
import { useSessionStatusesQuery } from "@/data/statuses";

interface UseSessionStatusesOptions {
  sessions: Session[];
  activeSessionId?: string | null;
  checkStateChanges: (
    states: Array<{
      id: string;
      name: string;
      status: SessionStatus["status"];
    }>,
    activeSessionId?: string | null
  ) => void;
}

export function useSessionStatuses({
  sessions,
  activeSessionId,
  checkStateChanges,
}: UseSessionStatusesOptions) {
  const { sessionStatuses } = useSessionStatusesQuery({
    sessions,
    activeSessionId,
    checkStateChanges,
  });

  return { sessionStatuses };
}
