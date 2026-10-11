import { useQuery } from "@tanstack/react-query";
import type { UsageRange, UsageReport } from "@/lib/usage/aggregate";
import type { UsageWindows } from "@/lib/usage/windows";
import type { SpendByModel } from "@/lib/usage/by-model";

export const usageKeys = {
  all: ["usage"] as const,
  report: (range: UsageRange) => [...usageKeys.all, range] as const,
};

export interface UsageResponse {
  report: UsageReport;
  // The orchestrator's reviewer and scope check runs, by PR.
  reviews: UsageReport;
  windows: UsageWindows;
  // By model and role, in the plan's 5-hour window and the last 24 hours.
  models: { fiveHour: SpendByModel; day: SpendByModel };
}

export function useUsageQuery(range: UsageRange, enabled = true) {
  return useQuery({
    queryKey: usageKeys.report(range),
    queryFn: async () => {
      const res = await fetch(`/api/usage?range=${range}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data as UsageResponse;
    },
    enabled,
    refetchInterval: enabled ? 60_000 : false,
    placeholderData: (prev) => prev,
  });
}
