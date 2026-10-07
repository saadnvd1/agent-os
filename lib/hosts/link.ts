/**
 * Link a machine's own AgentOS: ask it over ssh (where its loopback is
 * trusted) for a one-time pairing code, claim the code over the network, and
 * keep the device token that comes back. The token goes from the other
 * machine straight into this machine's database; nothing prints it.
 */

import os from "os";
import { getHost, hostExec, isRemoteHost } from "./index";
import {
  cleanRemoteText,
  hostApi,
  saveHostLink,
  type HostLink,
} from "./remote-api";
import { DEVICE_COOKIE } from "../security/auth";

export const DEFAULT_REMOTE_PORT = 3011;

export const sshHost = (sshTarget: string) =>
  sshTarget.split("@").pop()!.split(":")[0].toLowerCase();

export function defaultLinkUrl(sshTarget: string): string {
  return `http://${sshHost(sshTarget)}:${DEFAULT_REMOTE_PORT}`;
}

export function normalizeLinkUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("The address must start with http:// or https://");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Give just the address, like http://box:3011");
  return url.origin;
}

// The machine's front door forwards its port to AgentOS on the same port.
export function remotePort(url: string): number {
  const u = new URL(url);
  return Number(u.port) || (u.protocol === "https:" ? 443 : 80);
}

export function tokenFromSetCookie(header: string | null): string | null {
  for (const part of (header ?? "").split(/[;,]/)) {
    const [k, ...v] = part.trim().split("=");
    if (k === DEVICE_COOKIE && v.length) {
      try {
        return decodeURIComponent(v.join("=")) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function linkHost(
  hostId: string,
  rawUrl?: string
): Promise<{ url: string }> {
  const host = isRemoteHost(hostId) ? getHost(hostId) : null;
  if (!host) throw new Error("Pick another machine to link");
  const url = normalizeLinkUrl(rawUrl || defaultLinkUrl(host.ssh_target));
  // The pairing code goes to this address: only the machine itself, never
  // somewhere a caller picked.
  if (new URL(url).hostname !== sshHost(host.ssh_target))
    throw new Error(
      `The address must be ${sshHost(host.ssh_target)}, the machine's own`
    );
  const port = remotePort(url);

  const { stdout } = await hostExec(
    hostId,
    `curl -fsS -m 10 -X POST http://127.0.0.1:${port}/api/pair/start`,
    20000
  ).catch((err) => {
    throw new Error(
      `AgentOS isn't answering on ${host.name} (port ${port}): ${err.message}`
    );
  });
  const code = (JSON.parse(stdout) as { code?: string }).code;
  if (!code) throw new Error(`${host.name} gave no pairing code`);

  const res = await fetch(`${url}/api/pair/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: `AgentOS on ${os.hostname()}` }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  }).catch((err) => {
    throw new Error(`Can't reach ${url}: ${err.message}`);
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      `${host.name} refused the pairing: ${cleanRemoteText(data.error) || res.status}`
    );
  }
  const token = tokenFromSetCookie(res.headers.get("set-cookie"));
  if (!token) throw new Error(`${host.name} paired but sent no token`);

  const link: HostLink = { hostId, hostName: host.name, url, token };
  await hostApi(link, "/api/tasks");
  saveHostLink(hostId, url, token);
  return { url };
}
