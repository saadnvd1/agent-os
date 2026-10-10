/**
 * What a linked machine's session can't do from here yet, and why. Client
 * safe: the row menu shows these items disabled with the reason, and the
 * server refuses the same calls (peer-actions.ts). Open, copy link, rename,
 * pin, select, done and delete all work: the ones that change the session
 * run on its machine.
 */

export const REMOTE_UNSUPPORTED = {
  fork: (host: string) => `Runs on ${host}: fork it there`,
  freshStart: (host: string) => `Runs on ${host}: start fresh there`,
  moveToProject: (host: string) => `Its project follows its folder on ${host}`,
  schedule: (host: string) => `Check-ins can't message ${host} yet`,
};

export type RemoteAction = keyof typeof REMOTE_UNSUPPORTED;

/**
 * The reasons, per action, for a session a linked machine runs; null for
 * one this machine runs (or a task mirror, which keeps its own menu).
 */
export function remoteBlocks(
  session: { host_id: string | null; task_prompt: string | null },
  linkedHostName: (hostId: string) => string | undefined
): Record<RemoteAction, string> | null {
  if (!session.host_id || session.host_id === "local" || session.task_prompt)
    return null;
  const host = linkedHostName(session.host_id);
  if (!host) return null;
  return Object.fromEntries(
    Object.entries(REMOTE_UNSUPPORTED).map(([k, why]) => [k, why(host)])
  ) as Record<RemoteAction, string>;
}
