import { useQuery } from "@tanstack/react-query";
import type { SessionStatus } from "@/components/views/types";
import { statusKeys } from "../sessions/keys";
import { fetchStatuses } from "./queries";

// The sign-in a session's CLI is waiting on, read from the statuses the
// sidebar already keeps; asks for nothing of its own.
export function useSignIn(sessionId: string): SessionStatus["signIn"] {
  const { data } = useQuery({
    queryKey: statusKeys.all,
    queryFn: fetchStatuses,
    staleTime: 2000,
    select: (d) => d.statuses[sessionId]?.signIn ?? null,
  });
  return data;
}
