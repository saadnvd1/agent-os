import { WORKER_TMUX_PREFIX } from "../chat/worker/protocol";
import type { Project, Session } from "../db";
import type { TmuxSessionInfo } from "../status-detector";
import type { PeerSession } from "./peer-sessions";

// Folders are compared relative to ~ so a path reads the same on any machine;
// a session only nests under a project on its own machine.
export function homeRelative(path: string): string {
  const rel = path
    .replace(/\/{2,}/g, "/")
    .replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/root(?=\/|$)/, "~")
    .replace(/\/+$/, "");
  return rel || "/";
}

function isWithin(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir === "~" ? "~/" : `${dir}/`);
}

export interface DiscoveredSession extends TmuxSessionInfo {
  projectId: string | null;
  // A session a linked machine's AgentOS runs: opened here as its mirror.
  peer?: Pick<PeerSession, "id" | "name" | "view" | "agentType" | "state">;
}

const hostKey = (hostId: string | null | undefined, name: string) =>
  `${hostId || "local"}\t${name}`;

/** The project a folder on a machine sits in (the deepest), or null. */
export function projectMatcher(
  projects: Project[]
): (hostId: string, path: string) => string | null {
  const dirs = projects
    .filter((p) => !p.is_uncategorized)
    .map((p) => ({
      id: p.id,
      hostId: p.host_id || "local",
      dir: homeRelative(p.working_directory),
    }))
    .filter((p) => p.dir !== "~")
    .sort((a, b) => b.dir.length - a.dir.length);
  return (hostId, path) => {
    const rel = homeRelative(path);
    return (
      dirs.find((p) => p.hostId === hostId && isWithin(rel, p.dir))?.id ?? null
    );
  };
}

export function discoverSessions(
  tmuxSessions: TmuxSessionInfo[],
  projects: Project[],
  managed: Session[],
  peerSessions: PeerSession[] = []
): DiscoveredSession[] {
  // By machine and name: a session here doesn't hide one elsewhere.
  const managedNames = new Set(
    managed
      .filter((s) => s.tmux_name)
      .map((s) => hostKey(s.host_id, s.tmux_name))
  );
  const mirrored = new Set(managed.map((s) => s.id));
  const projectFor = projectMatcher(projects);

  const peers: TmuxSessionInfo[] = peerSessions
    .filter((p) => !mirrored.has(p.id))
    .map((p) => ({
      name: p.tmuxName || p.id,
      hostId: p.hostId,
      activity: p.activity,
      output: 0,
      path: p.path,
      attached: false,
      windows: 1,
      command: "",
      title: "",
      pid: 0,
      peer: {
        id: p.id,
        name: p.name,
        view: p.view,
        agentType: p.agentType,
        state: p.state,
      },
    }));

  return [
    ...tmuxSessions.filter(
      (t) =>
        !managedNames.has(hostKey(t.hostId, t.name)) &&
        !t.name.startsWith(WORKER_TMUX_PREFIX)
    ),
    ...peers,
  ]
    .map((t) => ({ ...t, projectId: projectFor(t.hostId, t.path) }))
    .sort((a, b) => b.activity - a.activity);
}
