/**
 * Talking to the Connect service (runagentos.com). Contract:
 * agentos-connect/docs/machine-api.md. After enrolment every request is
 * signed with the machine key, which never leaves this machine.
 */

import crypto from "crypto";
import type { ConnectConfig } from "./config";
import type { DnsChallenge, Register } from "./enrol";

export const DEFAULT_API = "https://runagentos.com";

export function signedHeaders(opts: {
  machineId: string;
  privateKey: string;
  method: string;
  path: string;
  body: string;
  now?: number;
  nonce?: string;
}): Record<string, string> {
  const ts = String(opts.now ?? Date.now());
  const nonce = opts.nonce ?? crypto.randomBytes(16).toString("base64url");
  const digest = crypto.createHash("sha256").update(opts.body).digest("hex");
  const message = [
    "agentos-connect-api",
    opts.method.toUpperCase(),
    opts.path,
    ts,
    nonce,
    digest,
  ].join("\n");
  return {
    "X-Connect-Machine": opts.machineId,
    "X-Connect-Timestamp": ts,
    "X-Connect-Nonce": nonce,
    "X-Connect-Signature": crypto
      .sign(null, Buffer.from(message), opts.privateKey)
      .toString("base64url"),
  };
}

async function call(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.ok) return res;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(
    body.error ?? `${init.method} ${new URL(url).pathname}: ${res.status}`
  );
}

/** Enrolment with a link code from "Connect a machine" in the web app. */
export function registerWithCode(
  apiUrl: string,
  linkCode: string,
  name: string
): Register {
  return async (publicKey) => {
    const res = await call(`${apiUrl}/api/v1/machines/enrol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        link_code: linkCode,
        name,
        public_key: publicKey,
      }),
    });
    const m = (await res.json()) as {
      machine_id: string;
      hostname: string;
      relay_url: string;
    };
    return {
      machineId: m.machine_id,
      hostname: m.hostname,
      relayUrl: m.relay_url,
      apiUrl,
    };
  };
}

function signed(config: ConnectConfig, privateKey: string) {
  return async (method: string, path: string, payload?: object) => {
    const body = payload ? JSON.stringify(payload) : "";
    return call(`${config.apiUrl}${path}`, {
      method,
      body: body || undefined,
      headers: {
        ...(body && { "Content-Type": "application/json" }),
        ...signedHeaders({
          machineId: config.machineId,
          privateKey,
          method,
          path,
          body,
        }),
      },
    });
  };
}

/** The Connect service's DNS broker: it writes only this machine's challenge. */
export function brokerDns(
  config: ConnectConfig,
  privateKey: string
): DnsChallenge {
  const send = signed(config, privateKey);
  const path = `/api/v1/machines/${config.machineId}/acme-challenge`;
  return {
    async set(name, value) {
      await send("POST", path, { name, value });
      await new Promise((r) => setTimeout(r, 15_000)); // let DNS catch up
    },
    async clear(name, value) {
      await send("DELETE", path, { name, value });
    },
  };
}

export async function heartbeat(
  config: ConnectConfig,
  privateKey: string,
  version: string
) {
  const res = await signed(config, privateKey)(
    "POST",
    `/api/v1/machines/${config.machineId}/heartbeat`,
    { version }
  );
  return (await res.json()) as { enabled: boolean };
}
