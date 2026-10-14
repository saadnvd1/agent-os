/** Connect's share API, answered in terms the dialog can act on. */

import { loadConnect } from "@/lib/connect/config";
import {
  ApiError,
  clean,
  listShares,
  revokeShare,
  uploadShare,
  type RemoteShare,
  type ShareExpiry,
} from "@/lib/connect/control-api";

export const NOT_LINKED = "Link this machine to Connect to share a link.";

export class ShareError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export const linked = () => loadConnect() !== null;

function files() {
  const f = loadConnect();
  if (!f) throw new ShareError(NOT_LINKED, 409);
  return f;
}

/** A failed call as a message that says what to do next. */
function explain(err: unknown): never {
  if (err instanceof ShareError) throw err;
  if (err instanceof ApiError) {
    if (err.status === 413)
      throw new ShareError(
        `Connect refused it as too big or over your quota: ${clean(err.message, 120)}`,
        413
      );
    if (err.status === 429)
      throw new ShareError(
        "Too many shares just now. Try again in a few minutes.",
        429
      );
    if (err.status === 401 || err.status === 403)
      throw new ShareError(
        "Connect doesn't accept this machine. Link it again in Settings → Devices & access.",
        502
      );
    if (err.status === 404) throw new ShareError("Not found on Connect.", 404);
    throw new ShareError(clean(err.message, 120), 502);
  }
  throw new ShareError("Couldn't reach Connect. Try again in a moment.", 502);
}

export async function createRemote(share: {
  kind: "chat" | "artifact";
  title: string;
  html: string;
  expiresIn: ShareExpiry;
}) {
  const { config, machineKey } = files();
  try {
    return await uploadShare(config, machineKey, share);
  } catch (err) {
    explain(err);
  }
}

export async function listRemote(): Promise<RemoteShare[]> {
  const { config, machineKey } = files();
  return listShares(config, machineKey);
}

/** Revokes on Connect; a share Connect no longer has counts as revoked. */
export async function revokeRemote(id: string): Promise<void> {
  const { config, machineKey } = files();
  try {
    await revokeShare(config, machineKey, id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return;
    explain(err);
  }
}
