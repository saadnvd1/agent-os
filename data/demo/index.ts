import { useQuery } from "@tanstack/react-query";

// Whether the server is a demo; undefined until it has answered. It can't
// change while the server runs.
export function useDemoMode(): boolean | undefined {
  return useQuery({
    queryKey: ["demo"],
    queryFn: async () => {
      const res = await fetch("/api/demo");
      if (!res.ok) return false;
      return ((await res.json()) as { demo?: boolean }).demo === true;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  }).data;
}
