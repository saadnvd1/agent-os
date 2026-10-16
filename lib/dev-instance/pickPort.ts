import net from "net";
import { DEFAULT_PORT, type InstanceRecord } from "./types";

type Env = Partial<NodeJS.ProcessEnv>;

export function forbiddenPorts(
  env: Env,
  live: InstanceRecord | null
): Set<number> {
  const fromUrl = (() => {
    try {
      return Number(new URL(env.AGENTOS_URL ?? "").port);
    } catch {
      return NaN;
    }
  })();
  return new Set(
    [DEFAULT_PORT, live?.port, Number(env.AGENTOS_PORT), fromUrl].filter(
      (p): p is number => Number.isInteger(p) && (p as number) > 0
    )
  );
}

function listens(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

export const portIsFree = async (port: number): Promise<boolean> =>
  (await listens(port, "127.0.0.1")) && (await listens(port, "0.0.0.0"));

export function assertNotLivePort(
  port: number,
  env: Env,
  live: InstanceRecord | null
): void {
  if (forbiddenPorts(env, live).has(port))
    throw new Error(
      `Refusing port ${port}: it is the live AgentOS server's. Use npm run dev:task for a free port.`
    );
}

export async function pickPort(opts: {
  requested?: number;
  env: Env;
  live: InstanceRecord | null;
  isFree?: (port: number) => Promise<boolean>;
}): Promise<number> {
  const { requested, env, live, isFree = portIsFree } = opts;
  if (requested !== undefined) assertNotLivePort(requested, env, live);
  const banned = forbiddenPorts(env, live);
  const assigned = Number(env.PORT);
  const candidates = [
    requested,
    Number.isInteger(assigned) ? assigned : undefined,
    ...Array.from({ length: 900 }, (_, i) => 3100 + i),
  ];
  for (const p of candidates) {
    if (p === undefined || banned.has(p)) continue;
    if (await isFree(p)) return p;
  }
  throw new Error("No free port found");
}
