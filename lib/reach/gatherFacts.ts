/**
 * Collects what the classifier reads. Every tool's output is reduced to a
 * label here: raw text can carry keys, tokens or account names, so it never
 * reaches a finding.
 */

import { execFile } from "child_process";
import fs from "fs";
import { promisify } from "util";
import { connectStatus, type ConnectStatus } from "@/lib/connect/serve";
import { connectDir, readConnect } from "@/lib/connect/config";
import { tailscaleStatus, type TailscaleState } from "@/lib/tailscale";
import { lanAddresses } from "@/lib/security/net";
import { lanEnabled } from "@/lib/security/network-settings";
import { reachFrom } from "@/lib/security/reach";
import { tailnetHttpsUrl } from "@/lib/security/tailnet-https";
import { probeConnect } from "./probeConnect";
import type { ConnectProbe, NotHere, ReachFacts } from "./types";

type Exec = (file: string, args: string[]) => Promise<string>;

export interface GatherDeps {
  connect: () => ConnectStatus;
  connectFiles: () => { enabled: boolean; controlHost?: string };
  tailscale: () => Promise<TailscaleState>;
  tailnetHttps: () => string | null;
  lan: () => { on: boolean; addresses: string[] };
  exec: Exec;
  readFile: (p: string) => string | null;
  probe: (hostname: string, controlHost: string) => Promise<ConnectProbe>;
  platform: NodeJS.Platform;
  nodePath: string;
  port: number;
  now: () => number;
}

const run = promisify(execFile);

export const defaultGatherDeps = (): GatherDeps => ({
  connect: connectStatus,
  connectFiles: () => {
    const r = readConnect(connectDir());
    if (!r.ok) return { enabled: false };
    let controlHost: string | undefined;
    try {
      controlHost = new URL(r.files.config.apiUrl).hostname;
    } catch {}
    return { enabled: r.enabled, controlHost };
  },
  tailscale: tailscaleStatus,
  tailnetHttps: tailnetHttpsUrl,
  lan: () => {
    const on = lanEnabled();
    return { on, addresses: on ? lanAddresses() : [] };
  },
  exec: async (file, args) =>
    (await run(file, args, { timeout: 3000 })).stdout.toString(),
  readFile: (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
  probe: (hostname, controlHost) => probeConnect(hostname, controlHost),
  platform: process.platform,
  nodePath: process.execPath,
  port: Number(process.env.AGENTOS_PORT || 3011),
  now: Date.now,
});

/** The server's own words for why Connect doesn't run here, as a label. */
export function notHereLabel(reason = ""): NotHere {
  if (reason === "AGENTOS_CONNECT=0") return "env-off";
  if (reason === "not a production build") return "dev-build";
  if (reason.startsWith("port ")) return "wrong-port";
  if (reason.includes("AGENTOS_AUTH=off")) return "auth-off";
  if (reason.includes("holds the tunnel")) return "lock";
  return "other";
}

const SOCKETFILTERFW = "/usr/libexec/ApplicationFirewall/socketfilterfw";

/**
 * Whether the firewall would stop devices on the Wi-Fi reaching node, read
 * without sudo. A guess from inside, so the classifier only ever warns.
 */
export async function readFirewall(
  deps: Pick<GatherDeps, "exec" | "readFile" | "platform" | "nodePath" | "port">
): Promise<ReachFacts["firewall"]> {
  try {
    if (deps.platform === "darwin") {
      const all = await deps.exec(SOCKETFILTERFW, ["--getblockall"]);
      if (
        /block all/i.test(all) &&
        /enabled/i.test(all) &&
        !/disabled/i.test(all)
      )
        return "blocks";
      const app = await deps.exec(SOCKETFILTERFW, [
        "--getappblocked",
        deps.nodePath,
      ]);
      return /\bblocked\b/i.test(app) && !/not blocked|permitted/i.test(app)
        ? "blocks"
        : "off";
    }
    if (deps.platform === "linux") {
      const conf = deps.readFile("/etc/ufw/ufw.conf");
      if (!conf) return "off";
      if (!/^\s*ENABLED\s*=\s*yes\s*$/m.test(conf)) return "off";
      // The rules file is often root-only: then it may block.
      const rules = deps.readFile("/etc/ufw/user.rules");
      return rules && new RegExp(`--dport ${deps.port}\\b`).test(rules)
        ? "off"
        : "blocks";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function gatherFacts(
  deps: GatherDeps = defaultGatherDeps()
): Promise<ReachFacts> {
  const c = deps.connect();
  const files = deps.connectFiles();
  const lan = deps.lan();
  const [ts, firewall] = await Promise.all([
    deps.tailscale(),
    lan.on ? readFirewall(deps) : Promise.resolve("off" as const),
  ]);
  const tsUrl = reachFrom(ts, [], deps.port, null, deps.tailnetHttps()).find(
    (r) => r.kind === "tailscale"
  )?.url;
  const linked = !!c.enrolled || !!c.hostname;
  // Off while switched on: the service stopped it (as good as refused), or
  // it hasn't started yet.
  const state =
    c.state === "off" && linked && files.enabled
      ? c.reason
        ? "denied"
        : "connecting"
      : c.state;
  const probe =
    state === "up" && c.hostname && files.controlHost
      ? await deps.probe(c.hostname, files.controlHost)
      : undefined;
  return {
    now: deps.now(),
    port: deps.port,
    lan,
    firewall,
    tailscale: { state: ts.state, ...(tsUrl && { url: tsUrl }) },
    connect: {
      state,
      linked,
      enabled: files.enabled,
      ...(c.hostname && { hostname: c.hostname }),
      ...(state === "refused" && { notHere: notHereLabel(c.reason) }),
      ...(c.stage && { stage: c.stage }),
      ...(c.downSince && { downSince: c.downSince }),
    },
    ...(probe && { probe }),
  };
}
