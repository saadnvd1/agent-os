import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clientConfigKeys } from "@/data/client-config/queries";

export function useSetOwnerName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string | null) => {
      const res = await fetch("/api/owner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save the name");
      return data.name as string | null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: clientConfigKeys.all }),
  });
}
