/**
 * Can other devices reach this machine, and if not, why. The facts are plain
 * labels gathered from the machine (gatherFacts.ts); the classifier turns them
 * into findings whose text comes from one table (classify.ts), so the CLI, the
 * web app and the phone app all say the same thing.
 */

export type ReachRoute = "connect" | "tailscale" | "lan";

export const REACH_CAUSES = [
  "no-route",
  "service-down",
  "service-stuck",
  "port-taken",
  "lan-off",
  "firewall",
  "tailscale-missing",
  "tailscale-logged-out",
  "connect-not-linked",
  "connect-off",
  "connect-not-here",
  "connect-denied",
  "connector-not-ready",
  "relay-down",
  "origin-down",
  "wrong-origin",
  "dns",
  "offline",
  "certificate",
] as const;

export type ReachCause = (typeof REACH_CAUSES)[number];

export type ReachStatus = "ok" | "warn" | "fail";

export interface ReachFinding {
  route?: ReachRoute;
  status: ReachStatus;
  cause?: ReachCause;
  /** "nothing": AgentOS is retrying by itself; "you": the fix line is for you. */
  needs: "you" | "nothing";
  title: string;
  /** One line: a command or what to do. Empty when nothing is needed. */
  fix: string;
  /** Its section of the reachability guide. */
  guide?: string;
  /** The link this route works on, when it works. */
  url?: string;
}

export interface ReachReport {
  status: ReachStatus;
  /** The best link another device can use right now. */
  url?: string;
  findings: ReachFinding[];
  checkedAt: string;
}

/** What answered when this machine fetched its own Connect address. */
export type ConnectProbe =
  | { kind: "ok" }
  | { kind: "wrong-origin" }
  // The edge's own error page: tunnel not connected, or origin unreachable.
  | { kind: "edge"; status: number; tunnel: boolean }
  | { kind: "dns"; scope: "host" | "all" }
  | { kind: "tls"; skewed: boolean }
  | { kind: "offline" }
  | { kind: "timeout" };

/** Why this server doesn't run Connect, as a label. */
export type NotHere =
  "env-off" | "dev-build" | "wrong-port" | "auth-off" | "lock" | "other";

export interface ReachFacts {
  now: number;
  port: number;
  lan: { on: boolean; addresses: string[] };
  /** Read-only firewall reading: "blocks" only when it would stop LAN devices. */
  firewall: "off" | "blocks" | "unknown";
  tailscale: {
    state: "running" | "logged-out" | "missing" | "unknown";
    url?: string;
  };
  connect: {
    state: "off" | "refused" | "error" | "connecting" | "up" | "denied";
    linked: boolean;
    enabled: boolean;
    hostname?: string;
    notHere?: NotHere;
    /** Where the last failure came from: fetching the connector, or the service. */
    stage?: "connector" | "service";
    /** When the tunnel was last seen leaving "up" (or first trying). */
    downSince?: number;
  };
  probe?: ConnectProbe;
}
