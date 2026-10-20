/**
 * The other machines on this machine's Connect account, and whether its plan
 * includes linking. Connect only introduces: a listed key is who may ask to
 * pair, never who is trusted (that takes the code typed on the target).
 *
 * Kept in memory, shared through globalThis by the server and the routes.
 * The list is fetched when it's older than a minute and someone needs it,
 * and marked stale when the heartbeat's peers_etag changes; fetches are
 * shared and spaced, so a flood of hellos can't hammer the service.
 */

import crypto from "crypto";
import { readConnect } from "../connect/config";
import {
  listPeers,
  type Beat,
  type Entitlements,
  type PeerList,
} from "../connect/control-api";
import { peerHostAllowed } from "./client";
import { rawPublic } from "./keys";
import { cleanMachineName } from "./name";
import { reconcilePins, type AccountSays } from "./revoke";
import { getSetting, putSetting } from "../settings-store";

export interface AccountPeer {
  id: string;
  name: string;
  hostname: string;
  /** Its Ed25519 public key, base64url of the raw 32 bytes. */
  signPub: string;
  lastSeenAt: string | null;
  version: string | null;
}

export interface AccountView {
  enrolled: boolean;
  entitlements: Entitlements | null;
  peers: AccountPeer[];
  /** When the list was last fetched, 0 if never. */
  fetchedAt: number;
  error: string | null;
  /** Set when the service hasn't answered for a day: since when. */
  uncheckedSince: number | null;
}

export const LIST_MAX_AGE_MS = 60_000;
export const UNCHECKED_NOTICE_MS = 24 * 3_600_000;
const OK_KEY = "peer.account_ok_at";
// The last answer is written down at most this often (it survives restarts).
const OK_SAVE_MS = 10 * 60_000;
// Never more often than this, whoever asks.
const MIN_GAP_MS = 5_000;

interface State {
  entitlements: Entitlements | null;
  etag: string | null;
  peers: AccountPeer[];
  fetchedAt: number;
  triedAt: number;
  stale: boolean;
  error: string | null;
  inflight: Promise<void> | null;
  okAt: number;
  okSavedAt: number;
}

export type Fetcher = () => Promise<PeerList | null>;

const g = globalThis as unknown as {
  __agentosPeerAccount?: State;
  __agentosPeerFetcher?: Fetcher;
};

const fresh = (): State => ({
  entitlements: null,
  etag: null,
  peers: [],
  fetchedAt: 0,
  triedAt: 0,
  stale: false,
  error: null,
  inflight: null,
  okAt: 0,
  okSavedAt: 0,
});

const state = () => (g.__agentosPeerAccount ??= fresh());

/** The signed call, or null when this machine isn't enrolled. */
const realFetcher: Fetcher = async () => {
  const read = readConnect();
  if (!read.ok) return null;
  return listPeers(read.files.config, read.files.machineKey);
};

/** Tests: a fake Connect service, and a clean slate. */
export function setAccountFetcher(f: Fetcher | null) {
  g.__agentosPeerFetcher = f ?? undefined;
  g.__agentosPeerAccount = fresh();
}

/** Control's SPKI PEM as the raw key the pins use, or null. */
export function rawFromSpki(pem: string): string | null {
  try {
    const key = crypto.createPublicKey(pem);
    return key.asymmetricKeyType === "ed25519" ? rawPublic(key) : null;
  } catch {
    return null;
  }
}

/** The service answered: links can be checked against it again. */
export function noteAccountOk(now = Date.now()) {
  const s = state();
  s.okAt = now;
  if (now - s.okSavedAt < OK_SAVE_MS) return;
  s.okSavedAt = now;
  try {
    putSetting(OK_KEY, String(now));
  } catch {
    // Bookkeeping only.
  }
}

/** When the service last answered; a first look starts the clock. */
function lastOk(now: number): number {
  const s = state();
  if (s.okAt) return s.okAt;
  let saved = NaN;
  try {
    saved = Number(getSetting(OK_KEY));
  } catch {
    // No database: count from now.
  }
  if (Number.isFinite(saved) && saved > 0) return (s.okAt = saved);
  noteAccountOk(now);
  return now;
}

function applyToPins(says: AccountSays) {
  try {
    reconcilePins(says);
  } catch (err) {
    console.error("peer revoke:", err);
  }
}

function adopt(list: PeerList) {
  const s = state();
  const peers: AccountPeer[] = [];
  for (const m of list.peers) {
    const signPub = rawFromSpki(m.publicKey);
    // Only a Connect machine's own name: a lying list can't aim this
    // machine anywhere else.
    if (!signPub || !peerHostAllowed(m.hostname)) continue;
    peers.push({
      id: m.id,
      name: cleanMachineName(m.name),
      hostname: m.hostname,
      signPub,
      lastSeenAt: m.lastSeenAt,
      version: m.version,
    });
  }
  s.peers = peers;
  if (list.entitlements) s.entitlements = list.entitlements;
  if (list.peersEtag) s.etag = list.peersEtag;
  s.fetchedAt = Date.now();
  s.stale = false;
  s.error = null;
  noteAccountOk(s.fetchedAt);
  applyToPins({
    linkMachines: s.entitlements?.linkMachines ?? null,
    listed: new Map(peers.map((p) => [p.id, p.signPub])),
  });
}

async function refresh(): Promise<void> {
  const s = state();
  if (s.inflight) return s.inflight;
  if (Date.now() - s.triedAt < MIN_GAP_MS) return;
  s.triedAt = Date.now();
  s.inflight = (async () => {
    try {
      const list = await (g.__agentosPeerFetcher ?? realFetcher)();
      if (list) adopt(list);
      else {
        s.peers = [];
        s.error = "This machine isn't connected to AgentOS Connect.";
      }
    } catch (err) {
      // The last list stays; only its age says it's old.
      s.error = `Can't reach your AgentOS account: ${
        err instanceof Error ? err.message : String(err)
      }`.slice(0, 300);
    } finally {
      s.inflight = null;
    }
  })();
  return s.inflight;
}

const enrolled = () =>
  g.__agentosPeerFetcher ? true : readConnect().ok === true;

/** The account's machines, fetched first if the list is older than maxAgeMs. */
export async function accountView(
  maxAgeMs = LIST_MAX_AGE_MS
): Promise<AccountView> {
  if (!enrolled())
    return {
      enrolled: false,
      entitlements: null,
      peers: [],
      fetchedAt: 0,
      error: null,
      uncheckedSince: null,
    };
  const s = state();
  if (s.stale || Date.now() - s.fetchedAt > maxAgeMs) await refresh();
  const now = Date.now();
  const ok = lastOk(now);
  return {
    enrolled: true,
    entitlements: s.entitlements,
    peers: s.peers,
    fetchedAt: s.fetchedAt,
    error: s.error,
    uncheckedSince: now - ok > UNCHECKED_NOTICE_MS ? ok : null,
  };
}

/** The machine as the account lists it now, or null when it isn't listed. */
export async function listedPeer(
  machineId: string
): Promise<AccountPeer | null> {
  const view = await accountView();
  return view.peers.find((p) => p.id === machineId) ?? null;
}

/** Whether the plan includes linking: null until the service has said. */
export async function linkingAllowed(): Promise<boolean | null> {
  const { entitlements } = await accountView();
  return entitlements ? entitlements.linkMachines : null;
}

/**
 * What a heartbeat says: the service is there, the plan now, and whether the
 * list changed, which is fetched again at once so a machine removed from the
 * account is suspended within a beat or so.
 */
export function noteHeartbeat(beat: Beat) {
  const s = state();
  noteAccountOk();
  const plan = beat.entitlements?.linkMachines;
  const planChanged =
    plan !== undefined && plan !== s.entitlements?.linkMachines;
  if (beat.entitlements) s.entitlements = beat.entitlements;
  if (beat.peersEtag && beat.peersEtag !== s.etag) {
    s.etag = beat.peersEtag;
    s.stale = true;
  }
  if (planChanged) applyToPins({ linkMachines: plan, listed: null });
  if (s.stale && enrolled()) void refresh();
}
