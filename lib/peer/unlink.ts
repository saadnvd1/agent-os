/**
 * Unlinking a machine linked through Connect, from either side. Here: the
 * pin goes at once (links.ts dropPin), then the other machine is told with a
 * signed POST /api/peer/unlink, best effort. There: the same call drops its
 * pin and its Machines says "Unlinked by <this machine>". If that call never
 * arrives, the other machine's next call here is answered with a signed
 * "unknown peer" (rpc-server.ts), which does the same.
 */

import { deleteHost } from "../hosts";
import { hostLink, type HostLink } from "../hosts/remote-api";
import { peerCall } from "./client";
import { dropPin, pinForHost } from "./links";

export const UNLINKED_HERE = "Unlinked here";

export interface UnlinkDeps {
  tell: (link: HostLink) => Promise<unknown>;
  remove: (hostId: string) => void;
}

const realDeps: UnlinkDeps = {
  tell: (link) =>
    peerCall(link, "/api/peer/unlink", { body: {}, timeout: 8_000 }),
  remove: deleteHost,
};

export interface UnlinkResult {
  name: string;
  /** The other machine confirmed it dropped its side. */
  told: boolean;
  /** The machine left Machines here too (it held no sessions or projects). */
  removed: boolean;
}

/** A person here unlinks it. Throws when it isn't linked through Connect. */
export async function unlinkPeer(
  hostId: string,
  deps: UnlinkDeps = realDeps
): Promise<UnlinkResult> {
  const link = hostLink(hostId);
  if (!link?.connect || !pinForHost(hostId))
    throw new Error("That machine isn't linked through Connect.");
  dropPin(hostId, { byPeer: false, reason: UNLINKED_HERE });
  let told = false;
  // A suspended link is refused there too; nothing would arrive.
  if (link.connect.state === "active")
    try {
      await deps.tell(link);
      told = true;
    } catch {
      // Best effort: its next call here is refused and says why.
    }
  let removed = false;
  try {
    deps.remove(hostId);
    removed = true;
  } catch {
    // It still holds sessions or projects; it stays, unlinked.
  }
  return { name: link.hostName, told, removed };
}
