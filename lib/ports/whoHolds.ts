import fs from "fs";
import { db } from "@/lib/db";
import { parsePorts } from "./allocatePorts";
import type {
  DevServerPortRow,
  Holder,
  Listener,
  PortCheck,
  SessionPortRow,
} from "./types";

const inside = (cwd: string, dir: string) =>
  cwd === dir || cwd.startsWith(dir.endsWith("/") ? dir : `${dir}/`);

const holdsPort = (s: SessionPortRow, port: number) =>
  s.devServerPort === port || Object.values(s.ports ?? {}).includes(port);

const asSession = (
  s: SessionPortRow,
  pid: number | null,
  listening: boolean
): Holder => ({
  kind: "session",
  sessionId: s.id,
  name: s.name,
  project: s.project,
  pid,
  listening,
});

/**
 * Who holds a port: the session whose worktree the listener runs in, the
 * Dev Servers panel's server, a Windows process, or a process outside
 * AgentOS. A listener whose cwd can't be read falls to the session that
 * holds the port, if any. With nothing listening, a session or panel server
 * that holds the port still has it. Null when it's free.
 */
export function whoHolds(
  port: number,
  listeners: Listener[],
  sessions: SessionPortRow[],
  devServers: DevServerPortRow[]
): Holder | null {
  const l = listeners.find((x) => x.port === port);
  const reserving = sessions.find((s) => holdsPort(s, port));
  const panel = devServers.find((d) => d.ports.includes(port));
  if (l) {
    if (l.cwd) {
      const s = sessions.find((x) => x.worktree && inside(l.cwd!, x.worktree));
      if (s) return asSession(s, l.pid, true);
    }
    const byPid = devServers.find((d) => d.pid !== null && d.pid === l.pid);
    if (byPid)
      return { kind: "dev-server", id: byPid.id, name: byPid.name, pid: l.pid };
    if (l.windows) return { kind: "windows", pid: l.pid };
    if (!l.cwd && reserving) return asSession(reserving, l.pid, true);
    return { kind: "outside", pid: l.pid, command: l.command, cwd: l.cwd };
  }
  if (reserving) return asSession(reserving, null, false);
  if (panel)
    return {
      kind: "dev-server",
      id: panel.id,
      name: panel.name,
      pid: panel.pid,
    };
  return null;
}

export function judgePort(
  askerId: string,
  name: string | null,
  port: number,
  listeners: Listener[] | null,
  sessions: SessionPortRow[],
  devServers: DevServerPortRow[]
): PortCheck {
  const holder = whoHolds(port, listeners ?? [], sessions, devServers);
  const mine = holder?.kind === "session" && holder.sessionId === askerId;
  const free =
    holder === null
      ? listeners === null
        ? null
        : true
      : mine && !holder.listening;
  return { name, port, free, holder, mine };
}

const real = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

// This machine's sessions that run in a worktree or hold ports.
export function localPortRows(): {
  sessions: SessionPortRow[];
  devServers: DevServerPortRow[];
} {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, p.name AS project, s.worktree_path, s.ports, s.dev_server_port
       FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
       WHERE (s.host_id IS NULL OR s.host_id = 'local')
         AND ((s.worktree_path IS NOT NULL AND s.archived_at IS NULL)
              OR s.ports IS NOT NULL OR s.dev_server_port IS NOT NULL)`
    )
    .all() as {
    id: string;
    name: string;
    project: string | null;
    worktree_path: string | null;
    ports: string | null;
    dev_server_port: number | null;
  }[];
  const servers = db
    .prepare(
      `SELECT id, name, pid, ports FROM dev_servers WHERE status IN ('running', 'starting')`
    )
    .all() as { id: string; name: string; pid: number | null; ports: string }[];
  return {
    sessions: rows.map((r) => ({
      id: r.id,
      name: r.name,
      project: r.project,
      worktree: r.worktree_path ? real(r.worktree_path) : null,
      ports: parsePorts(r.ports),
      devServerPort: r.dev_server_port,
    })),
    devServers: servers.map((d) => {
      let ports: number[] = [];
      try {
        const parsed = JSON.parse(d.ports) as unknown;
        if (Array.isArray(parsed))
          ports = parsed.filter((p): p is number => Number.isInteger(p));
      } catch {}
      return { id: d.id, name: d.name, pid: d.pid, ports };
    }),
  };
}

export function describeHolder(h: Holder): string {
  switch (h.kind) {
    case "session":
      return `session "${h.name}"${h.project ? ` (project ${h.project})` : ""}${h.pid ? `, pid ${h.pid}` : ""}${h.listening ? "" : ", which holds it but isn't listening yet"}`;
    case "dev-server":
      return `the Dev Servers panel's "${h.name}"${h.pid ? `, pid ${h.pid}` : ""}`;
    case "windows":
      return `a Windows process${h.pid ? ` (pid ${h.pid})` : ""}`;
    case "outside":
      return `${h.pid ? `pid ${h.pid}` : "a process"}${h.command ? ` (${h.command})` : ""}${h.cwd ? ` in ${h.cwd}` : ""}, outside AgentOS`;
  }
}
