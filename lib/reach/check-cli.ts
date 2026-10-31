/**
 * agent-os check [--json] [--via connect|tailscale|lan]: asks the server for
 * its reachability report. When the server can't answer, it looks at who is
 * on the port before naming a cause: AgentOS stuck, another program, or
 * nothing at all.
 */

import { finding } from "./classify";
import type { ReachFinding, ReachReport, ReachRoute } from "./types";

export interface CheckCliDeps {
  base: string;
  fetch: typeof fetch;
  out: (line: string) => void;
  /** The program listening on the port, from lsof, or null. */
  holder: () => Promise<string | null>;
  /** Whether a launchd/systemd service for AgentOS is installed. */
  serviceInstalled: () => boolean;
  now?: () => number;
  reportMs?: number;
  probeMs?: number;
}

const ROUTES = ["connect", "tailscale", "lan"] as const;
const PROGRAM = /^[A-Za-z0-9._-]{1,32}$/;

/** Exit code: 0 reachable, 1 a warning, 2 not reachable. */
export const exitCode = (r: ReachReport) =>
  ({ ok: 0, warn: 1, fail: 2 })[r.status];

async function report(
  deps: CheckCliDeps,
  want: ReachRoute[]
): Promise<ReachReport | null> {
  const q = new URLSearchParams({ fresh: "" });
  if (want.length) q.set("want", want.join(","));
  try {
    const res = await deps.fetch(`${deps.base}/api/reach?${q}`, {
      signal: AbortSignal.timeout(deps.reportMs ?? 20_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ReachReport;
  } catch {
    return null;
  }
}

/** The server didn't report: who, if anyone, is on its port? */
export async function whoIsOnThePort(
  deps: CheckCliDeps
): Promise<ReachFinding> {
  let answered = false;
  try {
    const res = await deps.fetch(`${deps.base}/api/reach/probe`, {
      signal: AbortSignal.timeout(deps.probeMs ?? 2_000),
    });
    answered = true;
    const body = (await res.json().catch(() => null)) as {
      boot?: unknown;
    } | null;
    if (res.ok && typeof body?.boot === "string")
      return finding("service-stuck", "fail");
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    if (!answered && code === "ECONNREFUSED")
      return finding("service-down", "fail", {
        alt: deps.serviceInstalled() ? undefined : "no-service",
      });
  }
  // Something holds the port but isn't AgentOS (or doesn't speak HTTP).
  const program = await deps.holder().catch(() => null);
  return finding("port-taken", "fail", {
    detail: program && PROGRAM.test(program) ? program : undefined,
  });
}

const MARK = { ok: "✓", warn: "!", fail: "✗" } as const;

export function printReport(r: ReachReport, out: (line: string) => void) {
  for (const f of r.findings) {
    const head = f.url ? `${f.title}: ${f.url}` : f.title;
    out(`${MARK[f.status]} ${head}`);
    if (f.status === "ok") continue;
    if (f.needs === "nothing") out("    Retrying on its own, nothing to do");
    else if (f.fix) out(`    → ${f.fix}`);
    if (f.guide && f.needs === "you") out(`    How to fix: ${f.guide}`);
  }
  if (r.status !== "ok" && r.url) out(`\nWorking link: ${r.url}`);
}

export async function runCheckCli(
  args: string[],
  deps: CheckCliDeps
): Promise<number> {
  const json = args.includes("--json");
  const via = args[args.indexOf("--via") + 1];
  const want = args.includes("--via") ? ROUTES.filter((r) => r === via) : [];
  if (args.includes("--via") && !want.length) {
    deps.out(`--via takes one of: ${ROUTES.join(", ")}`);
    return 2;
  }
  const r =
    (await report(deps, want)) ??
    ({
      status: "fail",
      findings: [await whoIsOnThePort(deps)],
      checkedAt: new Date(deps.now?.() ?? Date.now()).toISOString(),
    } satisfies ReachReport);
  if (json) deps.out(JSON.stringify(r, null, 2));
  else printReport(r, deps.out);
  return exitCode(r);
}
