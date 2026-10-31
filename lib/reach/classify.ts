/**
 * Turns reachability facts into findings. Pure: no I/O, no clock of its own.
 * Every title and fix line lives in CAUSES, which the guide quotes word for
 * word (guide-sync.test.ts), so the guide can't drift from what's printed.
 */

import type {
  ReachCause,
  ReachFacts,
  ReachFinding,
  ReachReport,
  ReachRoute,
  ReachStatus,
} from "./types";
import { slug } from "@/scripts/lib/heading-slugs";
import { guideUrl } from "@/lib/guides";

export const REACH_GUIDE = "reachability";

/** How long a cause AgentOS retries by itself stays "nothing to do". */
export const SELF_HEAL_MS = 5 * 60_000;

interface CauseText {
  title: string;
  fix: string;
  /** Other fixes for the same cause, picked by what the facts say. */
  alt?: Record<string, string>;
}

export const CAUSES: Record<ReachCause, CauseText> = {
  "no-route": {
    title: "No way in from other devices yet",
    fix: "agent-os setup",
  },
  "service-down": {
    title: "AgentOS isn't running",
    fix: "agent-os start",
    alt: { "no-service": "agent-os enable" },
  },
  "service-stuck": {
    title: "AgentOS holds its port but isn't answering",
    fix: "agent-os restart",
  },
  "port-taken": {
    title: "Another program holds AgentOS's port",
    fix: "Stop that program, or move AgentOS: AGENT_OS_PORT=3012 agent-os restart",
  },
  "lan-off": {
    title: "Wi-Fi access is off",
    fix: "agent-os setup --via lan",
  },
  firewall: {
    title: "The firewall may block devices on your Wi-Fi",
    fix: "Allow incoming connections for node in this computer's firewall settings",
  },
  "tailscale-missing": {
    title: "Tailscale isn't installed",
    fix: "Install it from tailscale.com/download, then run agent-os check",
  },
  "tailscale-logged-out": {
    title: "Tailscale is logged out",
    fix: "sudo tailscale up",
  },
  "connect-not-linked": {
    title: "Connect isn't linked",
    fix: "agent-os connect",
  },
  "connect-off": {
    title: "Connect is turned off",
    fix: "agent-os connect --on",
  },
  "connect-not-here": {
    title: "Connect can't run in this server",
    fix: "Start AgentOS without AGENTOS_CONNECT=0",
    alt: {
      lock: "Another AgentOS on this machine holds the tunnel: stop it, then agent-os restart",
      "dev-build": "Connect only runs from a production build: agent-os start",
      "wrong-port": "Connect follows AgentOS's own port: agent-os restart",
      "auth-off":
        "Connect never runs with pairing off: remove AGENTOS_AUTH=off",
      other: "agent-os logs",
    },
  },
  "connect-denied": {
    title: "Connect refused this machine",
    fix: "agent-os connect",
  },
  "connector-not-ready": {
    title: "The connector isn't connected yet",
    fix: "agent-os logs",
  },
  "relay-down": {
    title: "The Connect service isn't answering",
    fix: "agent-os logs",
  },
  "origin-down": {
    title: "Connect reaches this machine but AgentOS doesn't answer",
    fix: "agent-os restart",
  },
  "wrong-origin": {
    title: "Another AgentOS answers this address",
    fix: "Stop the other one, or run agent-os connect here",
  },
  dns: {
    title: "The address doesn't resolve",
    fix: "Wait a minute for it to publish, then agent-os check",
    alt: {
      all: "This computer can't look up names: check its network or DNS settings",
    },
  },
  offline: {
    title: "This computer is offline",
    fix: "Connect it to the internet, then agent-os check",
  },
  certificate: {
    title: "The certificate didn't check out",
    fix: "Something on this network intercepts HTTPS: try another network",
    alt: { clock: "Fix this computer's clock: it's more than 5 minutes off" },
  },
};

export const guideAnchor = (cause: ReachCause) => slug(CAUSES[cause].title);

/** The finding for a cause, with its fix picked from CAUSES. */
export function finding(
  cause: ReachCause,
  status: ReachStatus,
  opts: {
    route?: ReachRoute;
    alt?: string;
    needs?: "you" | "nothing";
    detail?: string;
  } = {}
): ReachFinding {
  const text = CAUSES[cause];
  const needs = opts.needs ?? "you";
  const fix = (opts.alt && text.alt?.[opts.alt]) || text.fix;
  return {
    ...(opts.route && { route: opts.route }),
    status,
    cause,
    needs,
    title: opts.detail ? `${text.title} (${opts.detail})` : text.title,
    fix: needs === "nothing" ? "" : fix,
    guide: guideUrl({ file: REACH_GUIDE, anchor: guideAnchor(cause) }),
  };
}

const ROUTE_TITLE: Record<ReachRoute, string> = {
  connect: "Reachable through Connect",
  tailscale: "Reachable on your Tailscale network",
  lan: "Reachable on this Wi-Fi",
};

const ok = (route: ReachRoute, url: string): ReachFinding => ({
  route,
  status: "ok",
  needs: "nothing",
  title: ROUTE_TITLE[route],
  fix: "",
  url,
});

// A cause AgentOS keeps retrying: nothing to do for a while, then it's yours.
function retrying(cause: ReachCause, facts: ReachFacts): ReachFinding {
  const since = facts.connect.downSince ?? facts.now;
  return facts.now - since < SELF_HEAL_MS
    ? finding(cause, "warn", { route: "connect", needs: "nothing" })
    : finding(cause, "fail", { route: "connect" });
}

function connectFinding(facts: ReachFacts): ReachFinding {
  const c = facts.connect;
  const url = c.hostname ? `https://${c.hostname}` : "";
  if (c.state === "refused")
    return finding("connect-not-here", "fail", {
      route: "connect",
      alt: c.notHere,
    });
  if (c.state === "denied")
    return finding("connect-denied", "fail", { route: "connect" });
  if (c.state === "off")
    return finding("connect-off", "fail", { route: "connect" });
  if (c.state !== "up")
    return retrying(
      c.stage === "service" ? "relay-down" : "connector-not-ready",
      facts
    );
  const p = facts.probe;
  if (!p || p.kind === "ok")
    return url ? ok("connect", url) : retrying("connector-not-ready", facts);
  switch (p.kind) {
    case "wrong-origin":
      return finding("wrong-origin", "fail", { route: "connect" });
    case "edge":
      if (p.tunnel) return retrying("connector-not-ready", facts);
      if (p.status === 502 || p.status === 504)
        return finding("origin-down", "fail", { route: "connect" });
      return retrying("relay-down", facts);
    case "dns":
      // This computer can't look anything up: others may still get in.
      return p.scope === "all"
        ? finding("dns", "warn", { route: "connect", alt: "all" })
        : retrying("dns", facts);
    case "tls":
      return p.skewed
        ? finding("certificate", "fail", { route: "connect", alt: "clock" })
        : finding("certificate", "warn", { route: "connect" });
    case "offline":
      return finding("offline", "fail", { route: "connect" });
    case "timeout":
      return retrying("relay-down", facts);
  }
}

/** The routes this machine is set up for: each one gets a finding. */
export function routesInUse(
  facts: ReachFacts,
  want: ReachRoute[] = []
): ReachRoute[] {
  const out: ReachRoute[] = [];
  if (
    (facts.connect.linked && facts.connect.enabled) ||
    want.includes("connect")
  )
    out.push("connect");
  if (facts.tailscale.state === "running" || want.includes("tailscale"))
    out.push("tailscale");
  if (facts.lan.on || want.includes("lan")) out.push("lan");
  return out;
}

function routeFinding(route: ReachRoute, facts: ReachFacts): ReachFinding {
  if (route === "connect")
    return facts.connect.linked
      ? connectFinding(facts)
      : finding("connect-not-linked", "fail", { route });
  if (route === "tailscale") {
    const t = facts.tailscale;
    if (t.state === "running" && t.url) return ok(route, t.url);
    return t.state === "logged-out" || t.state === "running"
      ? finding("tailscale-logged-out", "fail", { route })
      : finding("tailscale-missing", "fail", { route });
  }
  if (!facts.lan.on) return finding("lan-off", "fail", { route });
  // A firewall reading is a guess from inside: never more than a warning.
  if (facts.firewall === "blocks")
    return finding("firewall", "warn", { route });
  const ip = facts.lan.addresses[0];
  return ip
    ? ok(route, `http://${ip}:${facts.port}`)
    : finding("lan-off", "warn", { route });
}

/**
 * The report: one finding per route in use. Ok when every route works, warn
 * when at least one does (or one is only retrying), fail when none does.
 */
export function classifyReach(
  facts: ReachFacts,
  want: ReachRoute[] = []
): ReachReport {
  const checkedAt = new Date(facts.now).toISOString();
  const routes = routesInUse(facts, want);
  if (!routes.length) {
    // Linked but switched off is a clearer story than "no route".
    const only =
      facts.connect.linked && !facts.connect.enabled
        ? finding("connect-off", "fail", { route: "connect" })
        : finding("no-route", "fail");
    return { status: "fail", findings: [only], checkedAt };
  }
  const findings = routes.map((r) => routeFinding(r, facts));
  const url = findings.find((f) => f.url)?.url;
  const working = findings.some((f) => f.status === "ok");
  const retryingOnly = findings.every((f) => f.status !== "fail");
  const status: ReachStatus = findings.every((f) => f.status === "ok")
    ? "ok"
    : working || retryingOnly
      ? "warn"
      : "fail";
  return { status, ...(url && { url }), findings, checkedAt };
}
