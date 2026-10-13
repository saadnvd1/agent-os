import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuditRow } from "@/lib/approvals/no-approvals";
import { provePresence } from "../presence";
import { usePollWhenOffline } from "../push/connection";

export interface ApprovalsMode {
  on: boolean;
  audit: AuditRow[];
}

export const approvalsKeys = { all: ["approvals"] as const };

async function json(res: Response): Promise<ApprovalsMode> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Shared with the code that builds a terminal's launch command.
export const approvalsModeQuery = {
  queryKey: approvalsKeys.all,
  queryFn: async () => json(await fetch("/api/approvals")),
  staleTime: 10_000,
};

export function useApprovalsModeQuery() {
  return useQuery({
    ...approvalsModeQuery,
    refetchInterval: usePollWhenOffline(60_000),
  });
}

// Turning it on needs a passkey; turning it off doesn't.
export function useSetApprovalsMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (on: boolean) =>
      json(
        await fetch("/api/approvals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            on,
            ...(on
              ? {
                  assertion: await provePresence({
                    purpose: "no-approvals-on",
                  }),
                }
              : {}),
          }),
        })
      ),
    onSuccess: (data) => queryClient.setQueryData(approvalsKeys.all, data),
  });
}
