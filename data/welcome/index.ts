import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WelcomeGate } from "@/lib/welcome";

export const welcomeKeys = {
  all: ["welcome"] as const,
};

export function useWelcomeQuery() {
  return useQuery({
    queryKey: welcomeKeys.all,
    queryFn: async () => {
      const res = await fetch("/api/welcome");
      if (!res.ok) throw new Error("Couldn't check first-run setup");
      return (await res.json()) as WelcomeGate;
    },
    // Asked once per load: it only flips when setup is done here.
    staleTime: Infinity,
    retry: false,
  });
}

export function useCompleteWelcome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/welcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      if (!res.ok) throw new Error("Couldn't save setup");
      return (await res.json()) as WelcomeGate;
    },
    onSuccess: (gate) => client.setQueryData(welcomeKeys.all, gate),
  });
}
