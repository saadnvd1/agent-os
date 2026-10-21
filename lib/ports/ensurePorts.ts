import { db } from "@/lib/db";
import { portBases } from "@/lib/project-config";
import {
  projectPathOf,
  sessionConfig,
  sessionRunningBrief,
} from "@/lib/project-config/session";
import { allocatePorts, sessionPorts } from "./allocatePorts";
import { findHardcodedPorts, hardcodedNote } from "./findHardcodedPorts";
import { listListeners } from "./listListeners";
import { reassignPort } from "./reassignPort";
import type { PortCheck } from "./types";
import { describeHolder, judgePort, localPortRows } from "./whoHolds";

export interface PortReport {
  checks: PortCheck[];
  ports: Record<string, number>;
  moved: { name: string; from: number; to: number }[];
  // Something the caller asked about is taken by someone else.
  blocked: boolean;
  text: string;
}

export interface EnsureDeps {
  listeners: typeof listListeners;
  reassign: typeof reassignPort;
  allocate: typeof allocatePorts;
}

const realDeps: EnsureDeps = {
  listeners: listListeners,
  reassign: reassignPort,
  allocate: allocatePorts,
};

async function check(
  sessionId: string,
  name: string | null,
  port: number,
  deps: EnsureDeps
): Promise<PortCheck> {
  const { sessions, devServers } = localPortRows();
  return judgePort(
    sessionId,
    name,
    port,
    await deps.listeners(),
    sessions,
    devServers
  );
}

const say = (c: PortCheck): string => {
  const label = c.name ? `${c.name}=${c.port}` : String(c.port);
  if (c.free === null)
    return `${label}: this machine can't be asked who listens (no lsof).`;
  if (c.free) return `${label} is free.`;
  if (c.mine) return `${label} is your own server, already running.`;
  return `${label} is held by ${describeHolder(c.holder!)} on this machine. Don't wait for it and don't stop it.`;
};

/**
 * `aos port [NAME|PORT]`: whether the session's ports are free on this
 * machine and who holds the ones that aren't. A port of the session's that
 * someone else holds is moved to a free one, and the lines of its brief that
 * name it are given again with the new value. Asked about a port that isn't
 * the session's (one a project hardcodes), it says who holds that one and
 * how to run on the session's own instead.
 */
export async function ensurePorts(
  sessionId: string,
  target?: string,
  deps: EnsureDeps = realDeps
): Promise<PortReport> {
  if (!db.prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(sessionId))
    throw new Error(`No session ${sessionId}`);
  let ports = sessionPorts(sessionId);
  if (!ports) {
    const { config } = sessionConfig(sessionId);
    ports = (await deps.allocate(sessionId, portBases(config))).ports;
  }
  const names = Object.keys(ports);
  const lines: string[] = [];
  const checks: PortCheck[] = [];
  let mineToCheck = names;
  let blocked = false;
  if (target) {
    const asNumber = /^\d+$/.test(target) ? Number(target) : null;
    const byValue = names.find((n) => ports![n] === asNumber);
    if (names.includes(target)) mineToCheck = [target];
    else if (byValue) mineToCheck = [byValue];
    else if (asNumber !== null) {
      const foreign = await check(sessionId, null, asNumber, deps);
      checks.push(foreign);
      lines.push(say(foreign));
      if (foreign.free === false && !foreign.mine) blocked = true;
      mineToCheck = names.slice(0, 1);
    } else
      throw new Error(
        `No port named ${target}: yours are ${names.map((n) => `${n}=${ports![n]}`).join(", ")}`
      );
  }
  const moved: PortReport["moved"] = [];
  for (const name of mineToCheck) {
    const c = await check(sessionId, name, ports[name], deps);
    checks.push(c);
    if (c.free === false && !c.mine) {
      lines.push(say(c));
      const to = await deps.reassign(sessionId, name);
      moved.push({ name, from: c.port, to });
      lines.push(`Your ${name} is now ${to}: use it, not ${c.port}.`);
      blocked = true;
    } else lines.push(say(c));
  }
  ports = sessionPorts(sessionId) ?? ports;
  if (moved.length) {
    const fresh = moved.map((m) => String(m.to));
    const brief = sessionRunningBrief(sessionId)
      .split("\n")
      .filter((l) => l.startsWith("- ") && fresh.some((p) => l.includes(p)));
    if (brief.length) lines.push("With your new port:", ...brief);
  }
  const dir = projectPathOf(sessionId);
  if (dir) {
    const primary = Object.values(ports)[0];
    const hard = findHardcodedPorts(
      dir,
      sessionConfig(sessionId).config.dev,
      primary
    );
    for (const h of hard) lines.push(hardcodedNote(h));
  }
  if (blocked)
    lines.push(
      'If you need that exact port, tell the orchestrator (`aos send orchestrator "…"`) rather than waiting.'
    );
  return { checks, ports, moved, blocked, text: lines.join("\n") };
}
