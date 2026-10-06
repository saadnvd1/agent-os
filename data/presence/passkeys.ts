import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PasskeyView } from "@/lib/security/passkeys";
import { provePresence, registerPasskey } from "./index";

const passkeyKeys = { all: ["passkeys"] as const };

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function usePasskeysQuery(enabled = true) {
  return useQuery({
    queryKey: passkeyKeys.all,
    queryFn: async () =>
      json<{
        passkeys: PasskeyView[];
        bootstrapped: boolean;
      }>(await fetch("/api/presence/passkeys")),
    enabled,
  });
}

export function useAddPasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enrollCode?: string) => registerPasskey(enrollCode),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: passkeyKeys.all }),
  });
}

// A code for adding a passkey on another device, after Touch ID here.
export function useEnrollCode() {
  return useMutation({
    mutationFn: async () => {
      const assertion = await provePresence({ purpose: "enroll" });
      const res = await fetch("/api/presence/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assertion }),
      });
      return (await json<{ code: string }>(res)).code;
    },
  });
}

// Always with a passkey, the last one included.
export function useRevokePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const assertion = await provePresence({
        purpose: "revoke",
        passkeyId: id,
      });
      await json(
        await fetch(`/api/presence/passkeys/${id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assertion }),
        })
      );
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: passkeyKeys.all }),
  });
}
