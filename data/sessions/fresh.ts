import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

// Starts an orchestrator's or task's conversation over (lib/chat/refresh):
// now when idle, else after the running turn.
export function useFreshStart() {
  return useMutation({
    mutationFn: async (id: string): Promise<"now" | "after-turn"> => {
      const res = await fetch(`/api/sessions/${id}/fresh`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        when?: "now" | "after-turn";
        error?: string;
      };
      if (!res.ok || !body.when)
        throw new Error(body.error ?? "Couldn't start fresh");
      return body.when;
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
