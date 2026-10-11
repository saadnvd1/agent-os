import { useQuery } from "@tanstack/react-query";
import type { AuditIndexEntry } from "@/lib/session-audit/store";

export const auditKeys = {
  all: ["audits"] as const,
  report: (id: string) => [...auditKeys.all, id] as const,
};

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

export function useAuditsQuery() {
  return useQuery({
    queryKey: auditKeys.all,
    queryFn: async () =>
      (await get<{ audits: AuditIndexEntry[] }>("/api/audits")).audits,
  });
}

export function useAuditReportQuery(id: string | null) {
  return useQuery({
    queryKey: auditKeys.report(id ?? ""),
    queryFn: async () =>
      (await get<{ markdown: string }>(`/api/audits/${id}`)).markdown,
    enabled: !!id,
    // A report is written once and never changes.
    staleTime: Infinity,
  });
}
