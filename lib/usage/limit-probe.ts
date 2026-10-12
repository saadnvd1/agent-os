/**
 * One tiny request to read the account's limit windows from the
 * anthropic-ratelimit-unified-* headers on the reply, for the nightly rollup
 * when no response has carried a weekly reading lately. The headers come on
 * a rejection too. Needs CLAUDE_CODE_OAUTH_TOKEN in the server's environment;
 * the token is only ever sent to the API, never logged or stored.
 */

import { recordLooseCall } from "./calls";
import { recordReadings, toPercent, type Reading } from "./rate-limits";

const URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 20_000;

interface Headers {
  get(name: string): string | null;
}

export function readingsFromHeaders(h: Headers): Reading[] {
  const out: Reading[] = [];
  for (const [window, key] of [
    ["five_hour", "5h"],
    ["seven_day", "7d"],
  ] as const) {
    const u = h.get(`anthropic-ratelimit-unified-${key}-utilization`);
    const reset = h.get(`anthropic-ratelimit-unified-${key}-reset`);
    const raw = u === null ? NaN : Number(u);
    if (!Number.isFinite(raw) || raw < 0) continue;
    const resetS = reset === null ? NaN : Number(reset);
    out.push({
      window,
      utilization: toPercent(raw),
      raw,
      resetsAt: Number.isFinite(resetS) ? resetS * 1000 : null,
      status: h.get("anthropic-ratelimit-unified-status"),
    });
  }
  return out;
}

export type ProbeResult =
  | { ok: true; readings: Reading[] }
  | { ok: false; why: string };

export async function probeLimits(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<ProbeResult> {
  const token = env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) return { ok: false, why: "no token for a probe" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(URL, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const readings = readingsFromHeaders(res.headers);
    if (!readings.length)
      return { ok: false, why: "no limit headers on the reply" };
    recordReadings(readings, "probe", null, now);
    recordLooseCall({
      callKey: `probe:${now}`,
      at: now,
      sessionId: null,
      taskId: null,
      workspaceId: null,
      projectId: null,
      sessionName: "limit probe",
      role: "limit-probe",
      kind: "helper",
      agentType: null,
      model: MODEL,
      input: 8,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      output: 1,
      source: "helper",
    });
    return { ok: true, readings };
  } catch (e) {
    return {
      ok: false,
      why:
        e instanceof Error && e.name === "AbortError"
          ? "the probe timed out"
          : "the probe failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
