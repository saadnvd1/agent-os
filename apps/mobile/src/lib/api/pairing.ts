import { api, ApiError } from "./client";
import type { Machine } from "~/lib/machines/store";

export type Probe =
  | { state: "trusted"; via: NonNullable<Machine["via"]> }
  | { state: "needs-pairing" }
  | { state: "unreachable"; error: string };

// Whether this machine lets us in as we are: GET /api/devices answers 401
// when a device token is needed.
export async function probeMachine(
  url: string,
  token?: string
): Promise<Probe> {
  try {
    const res = await api<{ current?: { via?: Machine["via"] } }>(
      { url, token },
      "/api/devices",
      { timeoutMs: 8000 }
    );
    const via = res.current?.via ?? "device";
    // Let in as a device without a token of ours means someone else's
    // credential (a stray cookie): pair properly instead.
    if (via === "device" && !token) return { state: "needs-pairing" };
    return { state: "trusted", via };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401)
      return { state: "needs-pairing" };
    return {
      state: "unreachable",
      error: err instanceof Error ? err.message : "Can't reach the machine.",
    };
  }
}

// A machine that already trusts this phone (loopback, tailnet) still gets
// it paired, so the token works where trust doesn't reach, like Connect.
export async function pairTrusted(
  url: string,
  name: string
): Promise<string | null> {
  try {
    const { code } = await api<{ code: string }>({ url }, "/api/pair/start", {
      method: "POST",
    });
    const res = await api<{ device: { id: string }; token?: string }>(
      { url },
      "/api/pair/claim",
      {
        method: "POST",
        body: { code, name, token: true },
      }
    );
    if (res.token) return res.token;
    // An older server paired us but kept the token: don't leave that device behind.
    await api({ url }, `/api/devices/${encodeURIComponent(res.device.id)}`, {
      method: "DELETE",
    }).catch(() => {});
    return null;
  } catch {
    return null;
  }
}

export async function claimCode(url: string, code: string, name: string) {
  const res = await api<{
    device: { id: string; name: string };
    token?: string;
  }>({ url }, "/api/pair/claim", {
    method: "POST",
    body: { code, name, token: true },
  });
  if (!res.token)
    throw new ApiError(
      "This AgentOS is too old to pair a phone app. Update it first.",
      0
    );
  return { deviceId: res.device.id, token: res.token };
}
