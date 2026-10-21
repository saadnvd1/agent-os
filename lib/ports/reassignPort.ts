import { db } from "@/lib/db";
import { forbiddenPorts } from "@/lib/dev-instance/pickPort";
import { isPortInUse, portsTaken, sessionPorts } from "./allocatePorts";

const SEARCH = 1000;

// The live AgentOS server's ports: its own, and the ones its env names.
const livePorts = () => {
  const banned = forbiddenPorts(process.env, null);
  const own = Number(process.env.PORT);
  if (Number.isInteger(own) && own > 0) banned.add(own);
  return banned;
};

/**
 * Moves one of the session's ports to the next free one above it: not held
 * by another session or the Dev Servers panel, not listening, not AgentOS's
 * own. The slot stays, so the ports still go back when the session ends.
 * The claim rechecks under the write lock, like allocatePorts.
 */
export async function reassignPort(
  sessionId: string,
  name: string,
  inUse: (port: number) => Promise<boolean> = isPortInUse,
  banned: Set<number> = livePorts()
): Promise<number> {
  const ports = sessionPorts(sessionId);
  const from = ports?.[name];
  if (!ports || from === undefined)
    throw new Error(`This session has no port named ${name}`);
  const claim = db.transaction((port: number) => {
    if (portsTaken(sessionId).has(port)) return false;
    const next = { ...ports, [name]: port };
    db.prepare(
      `UPDATE sessions SET ports = ?, dev_server_port = ? WHERE id = ?`
    ).run(JSON.stringify(next), Object.values(next)[0] ?? null, sessionId);
    return true;
  });
  for (let port = from + 1; port <= Math.min(65535, from + SEARCH); port++) {
    if (banned.has(port) || portsTaken(sessionId).has(port)) continue;
    if (await inUse(port)) continue;
    if (claim.immediate(port)) return port;
  }
  throw new Error(`No free port in the ${SEARCH} above ${from}`);
}
