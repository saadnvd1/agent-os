import { useQuery, useMutation } from "@tanstack/react-query";
import { systemKeys } from "./keys";

interface VersionResponse {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
}

async function fetchVersion(): Promise<VersionResponse> {
  const res = await fetch("/api/system/version");
  if (!res.ok) throw new Error("Failed to check version");
  return res.json();
}

export function useUpdateCheckQuery() {
  return useQuery({
    queryKey: systemKeys.version(),
    queryFn: fetchVersion,
    refetchInterval: 5 * 60 * 1000, // 5 minutes
    staleTime: 4 * 60 * 1000,
  });
}

export function useApplyUpdate() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/system/update", { method: "POST" });
      if (!res.ok) throw new Error("Failed to trigger update");
      return res.json();
    },
  });
}
