/**
 * Talking to the Connect service (runagentos.com). Contract:
 * agentos-connect/docs/machine-api.md. After enrolment every request is
 * signed with the machine key, which never leaves this machine.
 */

import crypto from "crypto";
import { MACHINE_HOST, type ConnectConfig } from "./config";
import type { Register } from "./enrol";

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

/** A refusal from the Connect service, with its status and answer. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super(message);
  }
}

async function call(url: string, init: RequestInit): Promise<Response> {
  // Never follow a redirect: it would replay the link code or the signed
  // headers to whatever host the response names.
  const res = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (res.ok) return res;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  throw new ApiError(
    typeof body?.error === "string"
      ? clean(body.error)
      : `${init.method} ${new URL(url).pathname}: ${res.status}`,
    res.status,
    body && typeof body === "object" ? body : {}
  );
}

export interface Tunnel {
  hostname: string;
  /** The connector token: handed to cloudflared, never stored or logged. */
  token: string;
}

// Base64 of a small JSON object; anything else isn't a connector token.
const TOKEN = /^[A-Za-z0-9+/=_-]{32,4096}$/;

/** The service's answer, refused unless the name is exactly m-<16 hex>.runagentos.com. */
export function hostnameFrom(r: Record<string, unknown>): string {
  if (typeof r.hostname !== "string" || !MACHINE_HOST.test(r.hostname))
    throw new Error(
      "the Connect service sent a hostname that isn't m-<16 hex>.runagentos.com"
    );
  return r.hostname;
}

function tokenFrom(r: Record<string, unknown>): string {
  if (typeof r.tunnel_token !== "string" || !TOKEN.test(r.tunnel_token))
    throw new Error("the Connect service sent no usable tunnel token");
  return r.tunnel_token;
}

/** What enrolment answered: the machine's id and name (its token is unused). */
export function enrolled(m: unknown, apiUrl: string): ConnectConfig {
  const r = (m ?? {}) as Record<string, unknown>;
  const id = typeof r.machine_id === "string" ? r.machine_id : "";
  if (!MACHINE_ID.test(id))
    throw new Error("the Connect service sent an invalid machine id");
  return { machineId: id, hostname: hostnameFrom(r), apiUrl };
}

/**
 * Enrolment with a link code from "Connect a machine" in the web app. A key
 * the account already has is refused (409, naming its machine): this
 * machine then links again by signing for that id, keeping its name.
 */
export function registerWithCode(
  apiUrl: string,
  linkCode: string,
  name: string,
  port: number
): Register {
  return async ({ publicKey, privateKey }) => {
    try {
      const res = await call(`${apiUrl}/api/v1/machines/enrol`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          link_code: linkCode,
          name,
          public_key: publicKey,
          port,
        }),
      });
      return enrolled(await res.json(), apiUrl);
    } catch (err) {
      const id = err instanceof ApiError ? err.body.machine_id : undefined;
      if (
        !(err instanceof ApiError) ||
        err.status !== 409 ||
        typeof id !== "string" ||
        !MACHINE_ID.test(id)
      )
        throw err;
      const config = { machineId: id, hostname: "", apiUrl };
      const { hostname } = await requestTunnel(config, privateKey, port);
      return { ...config, hostname };
    }
  };
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

/**
 * Links (or relinks) this machine's tunnel to `port` and gets a fresh
 * connector token. Signed, so only the holder of machine.key can ask.
 */
export async function requestTunnel(
  config: ConnectConfig,
  privateKey: string,
  port: number
): Promise<Tunnel> {
  const res = await signed(config, privateKey)(
    "POST",
    `/api/v1/machines/${config.machineId}/tunnel`,
    { port }
  );
  const r = ((await res.json().catch(() => null)) ?? {}) as Record<
    string,
    unknown
  >;
  return { hostname: hostnameFrom(r), token: tokenFrom(r) };
}

/** What the account's plan allows; absent from an older Connect service. */
export interface Entitlements {
  plan: string;
  linkMachines: boolean;
  machineLimit: number;
}

export interface Beat {
  enabled: boolean;
  entitlements?: Entitlements;
  /** Changes whenever the list `peers` would give changes. */
  peersEtag?: string;
}

const ETAG = /^[A-Za-z0-9_-]{1,128}$/;

export function entitlementsFrom(raw: unknown): Entitlements | undefined {
  const e = (raw ?? null) as Record<string, unknown> | null;
  if (!e || typeof e !== "object" || typeof e.link_machines !== "boolean")
    return undefined;
  return {
    plan: typeof e.plan === "string" ? clean(e.plan, 32) : "unknown",
    linkMachines: e.link_machines,
    machineLimit:
      typeof e.machine_limit === "number" &&
      Number.isSafeInteger(e.machine_limit)
        ? e.machine_limit
        : 0,
  };
}

const etagFrom = (raw: unknown) =>
  typeof raw === "string" && ETAG.test(raw) ? raw : undefined;

export async function heartbeat(
  config: ConnectConfig,
  privateKey: string,
  version: string
): Promise<Beat> {
  const res = await signed(config, privateKey)(
    "POST",
    `/api/v1/machines/${config.machineId}/heartbeat`,
    { version }
  );
  const r = ((await res.json().catch(() => null)) ?? {}) as Record<
    string,
    unknown
  >;
  return {
    enabled: r.enabled !== false,
    entitlements: entitlementsFrom(r.entitlements),
    peersEtag: etagFrom(r.peers_etag),
  };
}

/** Another machine on this account, as the Connect service introduces it. */
export interface ListedMachine {
  id: string;
  name: string;
  hostname: string;
  /** Its Ed25519 key as the service holds it: SPKI PEM. */
  publicKey: string;
  lastSeenAt: string | null;
  version: string | null;
}

export interface PeerList {
  entitlements?: Entitlements;
  peersEtag?: string;
  peers: ListedMachine[];
}

const MAX_PEERS = 100;

/**
 * The account's other machines this one may link to. Only an introduction:
 * anything malformed is dropped here, and the keys still have to be
 * confirmed by a person on both machines before either trusts the other.
 */
export async function listPeers(
  config: ConnectConfig,
  privateKey: string
): Promise<PeerList> {
  const res = await signed(config, privateKey)(
    "GET",
    `/api/v1/machines/${config.machineId}/peers`
  );
  const r = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!r || !Array.isArray(r.peers))
    throw new Error("the Connect service sent no machine list");
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max ? v : null;
  const peers: ListedMachine[] = [];
  for (const raw of r.peers.slice(0, MAX_PEERS)) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const id = str(m.id, 8);
    const hostname = str(m.hostname, 253);
    const publicKey = str(m.public_key, 1024);
    if (!id || !MACHINE_ID.test(id) || !hostname || !publicKey) continue;
    if (id === config.machineId) continue;
    peers.push({
      id,
      name: clean(str(m.name, 500) ?? id, 80),
      hostname,
      publicKey,
      lastSeenAt: str(m.last_seen_at, 64),
      version: str(m.agent_os_version, 64),
    });
  }
  return {
    entitlements: entitlementsFrom(r.entitlements),
    peersEtag: etagFrom(r.peers_etag),
    peers,
  };
}

export interface PushRequestBody {
  v: 1;
  devices: { token: string; env: "production" | "sandbox" }[];
  push_type: "alert" | "background";
  priority: 10 | 5;
  level: "passive" | "active" | "time-sensitive";
  collapse_id?: string;
  thread_id?: string;
  payload: Record<string, unknown>;
}

export interface PushResult {
  status: "sent" | "gone" | "retry" | "rejected";
  apns_status?: number;
  reason?: string;
  prune?: boolean;
  retry_after?: number;
}

/** One APNs send per device, answered in device order. Signed. */
export async function pushRelay(
  config: ConnectConfig,
  privateKey: string,
  body: PushRequestBody
): Promise<PushResult[]> {
  const res = await signed(config, privateKey)(
    "POST",
    `/api/v1/machines/${config.machineId}/push`,
    body
  );
  const r = (await res.json().catch(() => null)) as {
    results?: PushResult[];
  } | null;
  if (!Array.isArray(r?.results))
    throw new Error("the Connect service sent no push results");
  return r.results;
}

export type ShareStatus = "active" | "expired" | "revoked";

/** A snapshot link as Connect reports it. The link itself is never in a list. */
export interface RemoteShare {
  id: string;
  kind: string;
  title: string;
  status: ShareStatus;
  byte_size: number;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
  expires_at: string | null;
}

export type ShareExpiry = "1d" | "7d" | "30d" | "never";

const shareFrom = (r: unknown): RemoteShare => {
  const s = (r ?? {}) as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.status !== "string")
    throw new Error("the Connect service sent an unusable share");
  return s as unknown as RemoteShare;
};

/** Uploads a rendered snapshot; the answer carries the public link, once. */
export async function uploadShare(
  config: ConnectConfig,
  privateKey: string,
  share: {
    kind: "chat" | "artifact";
    title: string;
    html: string;
    markdown: string;
    expiresIn: ShareExpiry;
  }
): Promise<RemoteShare & { url: string }> {
  const res = await signed(config, privateKey)(
    "POST",
    `/api/v1/machines/${config.machineId}/shares`,
    {
      kind: share.kind,
      title: share.title,
      html: share.html,
      markdown: share.markdown,
      expires_in: share.expiresIn,
    }
  );
  const r = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const url = r?.url;
  if (typeof url !== "string" || !/^https?:\/\//.test(url))
    throw new Error("the Connect service sent no link");
  return { ...shareFrom(r), url };
}

/** Replaces a live share's content under the same link. */
export async function replaceShare(
  config: ConnectConfig,
  privateKey: string,
  id: string,
  share: { title: string; html: string; markdown: string }
): Promise<void> {
  if (!/^[a-z0-9]{12}$/.test(id)) throw new Error("not a share id");
  await signed(config, privateKey)(
    "PUT",
    `/api/v1/machines/${config.machineId}/shares/${id}`,
    { title: share.title, html: share.html, markdown: share.markdown }
  );
}

export async function listShares(
  config: ConnectConfig,
  privateKey: string
): Promise<RemoteShare[]> {
  const res = await signed(config, privateKey)(
    "GET",
    `/api/v1/machines/${config.machineId}/shares`
  );
  const r = (await res.json().catch(() => null)) as {
    shares?: unknown[];
  } | null;
  if (!Array.isArray(r?.shares))
    throw new Error("the Connect service sent no share list");
  return r.shares.map(shareFrom);
}

export async function revokeShare(
  config: ConnectConfig,
  privateKey: string,
  id: string
): Promise<RemoteShare> {
  if (!/^[a-z0-9]{12}$/.test(id)) throw new Error("not a share id");
  const res = await signed(config, privateKey)(
    "DELETE",
    `/api/v1/machines/${config.machineId}/shares/${id}`
  );
  return shareFrom(await res.json().catch(() => null));
}

export type LiveExpiry = "1h" | "session";

export interface LiveShare {
  id: string;
  url: string;
  title: string;
  status: ShareStatus;
  expires_at: string | null;
  ends_with_session: boolean;
  max_guests: number;
}

/** Mints a live link for one session; the answer carries the link, once. */
export async function createLiveShare(
  config: ConnectConfig,
  privateKey: string,
  share: { title: string; expiresIn: LiveExpiry }
): Promise<LiveShare> {
  const res = await signed(config, privateKey)(
    "POST",
    `/api/v1/machines/${config.machineId}/live-shares`,
    { title: share.title, expires_in: share.expiresIn }
  );
  const r = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (
    typeof r?.id !== "string" ||
    typeof r.url !== "string" ||
    !/^https:\/\//.test(r.url)
  )
    throw new Error("the Connect service sent no link");
  return {
    id: r.id,
    url: r.url,
    title: typeof r.title === "string" ? r.title : share.title,
    status: (r.status as ShareStatus) ?? "active",
    expires_at: typeof r.expires_at === "string" ? r.expires_at : null,
    ends_with_session: r.ends_with_session === true,
    max_guests: typeof r.max_guests === "number" ? r.max_guests : 0,
  };
}
