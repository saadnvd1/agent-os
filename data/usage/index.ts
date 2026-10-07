import { useQuery } from "@tanstack/react-query";
import type { UsageRange, UsageReport } from "@/lib/usage/aggregate";
import type { UsageWindows } from "@/lib/usage/windows";

export const usageKeys = {
  all: ["usage"] as const,
  report: (range: UsageRange) => [...usageKeys.all, range] as const,
};

export interface UsageResponse {
  report: UsageReport;
  windows: UsageWindows;
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
