import { useQuery } from "@tanstack/react-query";
import type { AuditListItem } from "@/lib/session-audit/store";

export interface AuditRef {
  kind: string;
  id: string;
}

export const auditKeys = {
  all: ["audits"] as const,
  report: (ref: AuditRef | null) =>
    [...auditKeys.all, ref?.kind ?? "", ref?.id ?? ""] as const,
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
      (await get<{ audits: AuditListItem[] }>("/api/audits")).audits,
  });
}

export function useAuditReportQuery(ref: AuditRef | null) {
  return useQuery({
    queryKey: auditKeys.report(ref),
    queryFn: async () =>
      (
        await get<{ markdown: string }>(
          `/api/audits/${encodeURIComponent(ref!.kind)}/${encodeURIComponent(ref!.id)}`
        )
      ).markdown,
    enabled: !!ref,
    // A report is written once and never changes.
    staleTime: Infinity,
  });
}
