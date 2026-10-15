import type { Session } from "../../db";
import { requireHostLink } from "../../hosts/remote-api";
import type { MergeMethod } from "../merge-methods";
import * as client from "./client";
import { setMirrorStatus } from "./start";

/**
 * Sign off on the machine that runs it. It returns the method that machine
 * merged with; null when it doesn't say (an older AgentOS).
 */
export async function mergeThere(
  session: Session,
  head?: string,
  base?: string | null
): Promise<MergeMethod | null> {
  const link = requireHostLink(session.host_id);
  const res = await client.merge(
    link,
    session.id,
    head ? { head, base } : undefined,
    session.name
  );
  setMirrorStatus(session.id, "merged");
  if (head && res.head !== head)
    throw new Error(
      `${link.hostName} merged without confirming it was ${head.slice(0, 7)}`
    );
  return res.method;
}

/** Drop on the machine that runs it. */
export async function dropThere(session: Session): Promise<void> {
  await client.drop(requireHostLink(session.host_id), session.id);
  setMirrorStatus(session.id, "dropped");
}
