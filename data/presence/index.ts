import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type { PresencePurpose } from "@/lib/security/presence";

async function post<T>(url: string, body: object): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Browsers offer passkeys only over https or on localhost.
export const passkeysHere = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  location.hostname !== "127.0.0.1" &&
  !!window.PublicKeyCredential;

export const NO_PASSKEYS_HERE =
  "Approving this needs a passkey, and passkeys need https or localhost: approve it on the machine running AgentOS, or over Connect.";

// Adds a passkey on this browser: free for the very first one, otherwise
// with a code from a device that has one.
export async function registerPasskey(enrollCode?: string): Promise<void> {
  const { options } = await post<{
    options: PublicKeyCredentialCreationOptionsJSON;
  }>("/api/presence/register/options", { enrollCode });
  const response = await startRegistration({ optionsJSON: options });
  await post("/api/presence/register/verify", { response, enrollCode });
}

// Touch ID / Face ID on a challenge bound to exactly this. The first time,
// with no passkey anywhere yet, it makes one.
export async function provePresence(req: {
  purpose: PresencePurpose;
  workspaceId?: string;
  askId?: number;
  binding?: string;
  passkeyId?: string;
}): Promise<AuthenticationResponseJSON> {
  if (!passkeysHere()) throw new Error(NO_PASSKEYS_HERE);
  type Answer = {
    options?: PublicKeyCredentialRequestOptionsJSON;
    needsPasskey?: boolean;
    canBootstrap?: boolean;
  };
  let answer = await post<Answer>("/api/presence/options", req);
  if (answer.needsPasskey) {
    if (!answer.canBootstrap)
      throw new Error(
        "This browser has no passkey yet. Get a code in Devices on a device that has one, then add a passkey here."
      );
    await registerPasskey();
    answer = await post<Answer>("/api/presence/options", req);
  }
  if (!answer.options) throw new Error("No passkey for this host");
  return startAuthentication({ optionsJSON: answer.options });
}
