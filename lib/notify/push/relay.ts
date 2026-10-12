/** The Connect push relay, answered in terms the sender can act on. */

import {
  ApiError,
  clean,
  pushRelay,
  type PushRequestBody,
  type PushResult,
} from "@/lib/connect/control-api";
import { loadConnect } from "@/lib/connect/config";

export type RelayAnswer =
  | { kind: "results"; results: PushResult[] }
  // Nothing will go until someone fixes it: don't ask again for a while.
  | { kind: "unavailable"; reason: string }
  // The request itself is wrong: retrying can't help.
  | { kind: "invalid"; reason: string }
  | { kind: "retry"; reason: string; afterMs?: number };

export const NOT_LINKED = "this machine isn't linked to Connect";

/** Whether this machine can reach the relay at all. */
export const linked = () => loadConnect() !== null;

export async function relaySend(body: PushRequestBody): Promise<RelayAnswer> {
  const files = loadConnect();
  if (!files) return { kind: "unavailable", reason: NOT_LINKED };
  try {
    const results = await pushRelay(files.config, files.machineKey, body);
    return { kind: "results", results };
  } catch (err) {
    if (err instanceof ApiError) {
      const why = clean(err.message, 120);
      if (err.status === 503 && err.body.error === "push_not_configured")
        return {
          kind: "unavailable",
          reason: "push isn't set up on the Connect service yet",
        };
      if (err.status === 401 || err.status === 403 || err.status === 503)
        return { kind: "unavailable", reason: why };
      if (err.status === 400 || err.status === 413)
        return { kind: "invalid", reason: why };
      return { kind: "retry", reason: why };
    }
    return {
      kind: "retry",
      reason: err instanceof Error ? clean(err.message, 120) : "network error",
    };
  }
}
