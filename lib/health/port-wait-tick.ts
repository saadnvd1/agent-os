/**
 * The I/O half of port-wait (port-wait.ts decides): once a minute, find the
 * sessions' shell loops that have waited on a port for long enough, ask who
 * holds that port, and when it's someone else tell the agent and its
 * orchestrator once per holder. Nothing is stopped: a sleeping loop costs
 * nothing, and the agent ends its own job. Each machine judges its own
 * sessions, since ports only meet inside one machine's network.
 */

import { execFile } from "child_process";
import { sendMessage } from "../bus";
import { db } from "../db";
import { readSnapshot } from "../load/usage";
import { queueEventOnce } from "../orchestrator/events";
import { untrusted } from "../orchestrator/untrusted";
import {
  describeHolder,
  judgePort,
  listListeners,
  localPortRows,
  sessionPorts,
  type Holder,
} from "../ports";
import { cwdsOf } from "../ports/listListeners";
import type { HealthConfig } from "./config";
import {
  findPortWaits,
  parsePsArgs,
  portWaitLine,
  portWaitNote,
  waitedPorts,
  type ArgsProc,
  type WaitSession,
} from "./port-wait";
import { close, recordTrips } from "./store";
import { MIN, type Trip } from "./types";

export interface PortWaitDeps {
  procs: () => Promise<ArgsProc[] | null>;
  panes: () => Promise<{ tmux: string; pid: number }[]>;
  cwds: (pids: number[]) => Promise<Map<number, string>>;
  listeners: typeof listListeners;
  portRows: typeof localPortRows;
  sessions: () => WaitSession[];
  tell: (sessionId: string, body: string) => Promise<void>;
  event: (
    workspaceId: string,
    key: string,
    subject: string,
    line: string,
    now: number
  ) => void;
  record: (trip: Trip, now: number) => void;
}

const readArgs = (): Promise<ArgsProc[] | null> =>
  new Promise((resolve) =>
    execFile(
      "ps",
      ["-Ao", "pid=,ppid=,etime=,args="],
      { timeout: 5000, maxBuffer: 16 << 20 },
      (err, out) => {
        const rows = err ? [] : parsePsArgs(out);
        resolve(rows.length ? rows : null);
      }
    )
  );

function localSessions(): WaitSession[] {
  return (
    db
      .prepare(
        `SELECT s.id, s.name, p.workspace_id, s.tmux_name, s.worktree_path
         FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
         WHERE s.archived_at IS NULL AND (s.host_id IS NULL OR s.host_id = 'local')`
      )
      .all() as {
      id: string;
      name: string;
      workspace_id: string | null;
      tmux_name: string | null;
      worktree_path: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    workspaceId: r.workspace_id,
    tmuxName: r.tmux_name,
    worktree: r.worktree_path,
  }));
}

export const realPortWait: PortWaitDeps = {
  procs: readArgs,
  panes: async () => (await readSnapshot()).panes,
  cwds: cwdsOf,
  listeners: listListeners,
  portRows: localPortRows,
  sessions: localSessions,
  tell: async (sessionId, body) => {
    await sendMessage({
      fromId: null,
      to: sessionId,
      body,
      fromLabel: "AgentOS health",
      origin: { kind: "system", label: "Health", body },
    });
  },
  event: (ws, key, subject, line, now) => {
    queueEventOnce(ws, key, subject, line, now);
  },
  record: (trip, now) => {
    const { opened } = recordTrips([trip], [], now);
    // History only: the agent and orchestrator are told directly.
    for (const row of opened) close(row.id, "told", now);
  },
};

const holderKey = (h: Holder) =>
  h.kind === "session"
    ? `s:${h.sessionId}`
    : h.kind === "dev-server"
      ? `d:${h.id}`
      : `${h.kind}:${h.pid}`;

// session:port -> the holder it was told about. A wait that ends, or a new
// holder, re-arms it.
const told = new Map<string, string>();
let running = false;

export function resetPortWait(): void {
  told.clear();
  running = false;
}

export async function portWaitTick(
  now: number,
  c: HealthConfig,
  deps: PortWaitDeps = realPortWait
): Promise<void> {
  const minMs = c.portWaitMinutes * MIN;
  if (!minMs || running) return;
  running = true;
  try {
    const procs = await deps.procs();
    if (!procs) return;
    const old = procs.filter(
      (p) => p.ageMs >= minMs && waitedPorts(p.args).length
    );
    if (!old.length) {
      told.clear();
      return;
    }
    const [panes, cwds] = await Promise.all([
      deps.panes(),
      deps.cwds(old.map((p) => p.pid)),
    ]);
    const waits = findPortWaits(procs, deps.sessions(), panes, cwds, minMs);
    const live = new Set(waits.map((w) => `${w.sessionId}:${w.port}`));
    for (const k of told.keys()) if (!live.has(k)) told.delete(k);
    if (!waits.length) return;
    const listeners = await deps.listeners();
    if (!listeners) return;
    const { sessions, devServers } = deps.portRows();
    for (const w of waits) {
      const check = judgePort(
        w.sessionId,
        null,
        w.port,
        listeners,
        sessions,
        devServers
      );
      if (!check.holder || check.mine) continue;
      const key = `${w.sessionId}:${w.port}`;
      const who = holderKey(check.holder);
      if (told.get(key) === who) continue;
      told.set(key, who);
      const holder = describeHolder(check.holder);
      const line = portWaitLine(w, holder);
      try {
        deps.record(
          {
            check: "port-wait",
            subject: key,
            severity: "warn",
            line,
            detail: {
              sessionId: w.sessionId,
              port: w.port,
              pid: w.pid,
              holder: check.holder,
            },
            workspaceId: w.workspaceId,
          },
          now
        );
      } catch (error) {
        console.error("[health] port-wait record:", error);
      }
      if (w.workspaceId)
        deps.event(
          w.workspaceId,
          `port-wait:${key}:${who}`,
          w.sessionId,
          // Session names and commands are agents' own text.
          `Health (tasks): ${untrusted("health detector", line)}`,
          now
        );
      try {
        await deps.tell(
          w.sessionId,
          portWaitNote(w, holder, sessionPorts(w.sessionId))
        );
      } catch (error) {
        console.error("[health] port-wait note:", error);
      }
    }
  } finally {
    running = false;
  }
}
