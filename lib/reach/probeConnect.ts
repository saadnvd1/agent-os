/**
 * Fetches this machine's own Connect address from here, to prove the whole
 * path works: DNS, the certificate, the edge, the connector and this server.
 * /api/reach/probe answers with this process's boot id, so an answer from a
 * cache or another AgentOS can't pass for ours.
 */

import { randomBytes } from "crypto";
import { lookup } from "dns/promises";
import type { ConnectProbe } from "./types";

const g = globalThis as unknown as { __agentosBoot?: string };
/** Random per process; the route and the probe must see the same one. */
export const bootId = () =>
  (g.__agentosBoot ??= randomBytes(8).toString("hex"));

export const PROBE_PATH = "/api/reach/probe";
const PROBE_MS = 8_000;
const SKEW_MS = 5 * 60_000;

export interface ProbeDeps {
  fetch: typeof fetch;
  /** Whether a name resolves at all. */
  resolves: (name: string) => Promise<boolean>;
  now: () => number;
}

const defaultDeps: ProbeDeps = {
  fetch: (...a) => fetch(...a),
  resolves: (name) =>
    lookup(name).then(
      () => true,
      () => false
    ),
  now: Date.now,
};

const DNS = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_NONAME"]);
const OFFLINE = new Set([
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "ECONNREFUSED",
]);
const TLS = /^(CERT_|ERR_TLS_|ERR_SSL_)|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)/;

function errorCode(err: unknown): string {
  const e = err as { name?: string; code?: string; cause?: { code?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "TIMEOUT";
  return String(e?.cause?.code ?? e?.code ?? "");
}

// The clock is off when a server's Date header disagrees by minutes. Over
// plain HTTP, so a broken certificate can't hide the answer.
async function clockSkewed(
  deps: ProbeDeps,
  controlHost: string
): Promise<boolean> {
  try {
    const res = await deps.fetch(`http://${controlHost}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_MS),
    });
    const date = Date.parse(res.headers.get("date") ?? "");
    return Number.isFinite(date) && Math.abs(date - deps.now()) > SKEW_MS;
  } catch {
    return false;
  }
}

export async function probeConnect(
  hostname: string,
  controlHost: string,
  boot = bootId(),
  deps: ProbeDeps = defaultDeps
): Promise<ConnectProbe> {
  let res: Response;
  try {
    res = await deps.fetch(`https://${hostname}${PROBE_PATH}`, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_MS),
    });
  } catch (err) {
    const code = errorCode(err);
    if (code === "TIMEOUT") return { kind: "timeout" };
    if (DNS.has(code))
      return {
        kind: "dns",
        scope: (await deps.resolves(controlHost)) ? "host" : "all",
      };
    if (TLS.test(code))
      return {
        kind: "tls",
        skewed:
          code === "CERT_NOT_YET_VALID" ||
          (await clockSkewed(deps, controlHost)),
      };
    if (OFFLINE.has(code)) return { kind: "offline" };
    return { kind: "timeout" };
  }
  if (res.status >= 500) {
    const body = await res.text().catch(() => "");
    // 530 with error 1033: the edge has no connector for this address.
    const tunnel = res.status === 530 || /\b1033\b/.test(body);
    return { kind: "edge", status: res.status, tunnel };
  }
  if (res.status !== 200) return { kind: "wrong-origin" };
  const body = (await res.json().catch(() => null)) as {
    boot?: unknown;
  } | null;
  return body?.boot === boot ? { kind: "ok" } : { kind: "wrong-origin" };
}
