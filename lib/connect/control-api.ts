/**
 * Talking to the Connect service (runagentos.com). Contract:
 * agentos-connect/docs/machine-api.md. After enrolment every request is
 * signed with the machine key, which never leaves this machine.
 */

import crypto from "crypto";
import type { ConnectConfig } from "./config";
import type { DnsChallenge, Register } from "./enrol";

export const DEFAULT_API = "https://runagentos.com";
export const MACHINE_ID = /^[a-z0-9]{8}$/;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The Connect service must be https with no credentials in the URL; plain
 * http to this machine is for operators testing a local control plane. */
export function checkApiUrl(raw: string, operator: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`CONNECT_API_URL is not a URL: ${clean(raw)}`);
  }
  if (url.username || url.password)
    throw new Error("CONNECT_API_URL must not carry a username or password");
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(local && operator))
    throw new Error(
      "CONNECT_API_URL must be https (http://localhost needs AGENTOS_CONNECT_OPERATOR=1)"
    );
  return url.origin;
}

/** Server text printed to a terminal: no control characters, bounded. */
export function clean(text: string, max = 200): string {
   
  const s = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

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
  // Never follow a redirect: it would replay the link code or the signed
  // headers to whatever host the response names.
  const res = await fetch(url, { ...init, redirect: "error" });
  if (res.ok) return res;
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  throw new Error(
    typeof body.error === "string"
      ? clean(body.error)
      : `${init.method} ${new URL(url).pathname}: ${res.status}`
  );
}

/** Enrolment with a link code from "Connect a machine" in the web app. */
export function registerWithCode(
  apiUrl: string,
  linkCode: string,
  name: string,
  domain: string
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
    return { ...enrolled(await res.json(), domain), apiUrl };
  };
}

/** What the service answered, refused unless it names exactly <id>.<domain>. */
export function enrolled(m: unknown, domain: string): ConnectConfig {
  const r = (m ?? {}) as Record<string, unknown>;
  const id = typeof r.machine_id === "string" ? r.machine_id : "";
  if (!MACHINE_ID.test(id))
    throw new Error("the Connect service sent an invalid machine id");
  if (r.hostname !== `${id}.${domain}`)
    throw new Error(`the Connect service sent a hostname outside ${domain}`);
  if (typeof r.relay_url !== "string" || !r.relay_url.startsWith("wss://"))
    throw new Error("the Connect service sent a relay URL that isn't wss://");
  return { machineId: id, hostname: r.hostname, relayUrl: r.relay_url };
}

function signed(config: ConnectConfig, privateKey: string) {
  if (!MACHINE_ID.test(config.machineId))
    throw new Error("connect.json has an invalid machine id");
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
