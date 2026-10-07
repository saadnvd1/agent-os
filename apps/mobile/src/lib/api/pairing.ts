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
    return { state: "trusted", via: res.current?.via ?? "device" };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401)
      return { state: "needs-pairing" };
    return {
      state: "unreachable",
      error: err instanceof Error ? err.message : "Can't reach the machine.",
    };
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
