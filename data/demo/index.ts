import { useQuery } from "@tanstack/react-query";

// Whether the server is a demo; undefined until it has answered. It can't
// change while the server runs.
export function useDemoMode(): boolean | undefined {
  return useQuery({
    queryKey: ["demo"],
    // Any failure counts as not a demo: terminals wait on this answer.
    queryFn: async () => {
      try {
        const res = await fetch("/api/demo");
        if (!res.ok) return false;
        return ((await res.json()) as { demo?: boolean }).demo === true;
      } catch {
        return false;
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  }).data;
}
