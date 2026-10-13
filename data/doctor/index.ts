import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DoctorCheck } from "@/lib/doctor/checks";

export const doctorKeys = {
  all: ["doctor"] as const,
};

async function fetchChecks(fresh: boolean) {
  const res = await fetch(fresh ? "/api/doctor?fresh" : "/api/doctor");
  if (!res.ok) throw new Error("Couldn't run the health checks");
  return ((await res.json()) as { checks: DoctorCheck[] }).checks;
}

export function useDoctorQuery() {
  return useQuery({
    queryKey: doctorKeys.all,
    queryFn: () => fetchChecks(false),
    staleTime: 30_000,
    refetchOnMount: "always",
  });
}

export function useRecheckDoctor() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => fetchChecks(true),
    onSuccess: (checks) => client.setQueryData(doctorKeys.all, checks),
  });
}
