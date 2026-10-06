import type { Project, Session } from "../db";
import type { TmuxSessionInfo } from "../status-detector";

// Folders are compared relative to ~ so a path reads the same on any machine;
// a session only nests under a project on its own machine.
export function homeRelative(path: string): string {
  const rel = path
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
}

export function discoverSessions(
  tmuxSessions: TmuxSessionInfo[],
  projects: Project[],
  managed: Session[]
): DiscoveredSession[] {
  const managedNames = new Set(managed.map((s) => s.tmux_name).filter(Boolean));
  const dirs = projects
    .filter((p) => !p.is_uncategorized)
    .map((p) => ({
      id: p.id,
      hostId: p.host_id || "local",
      dir: homeRelative(p.working_directory),
    }))
    .filter((p) => p.dir !== "~")
    .sort((a, b) => b.dir.length - a.dir.length);

  return tmuxSessions
    .filter((t) => !managedNames.has(t.name))
    .map((t) => {
      const path = homeRelative(t.path);
      const match = dirs.find(
        (p) => p.hostId === t.hostId && isWithin(path, p.dir)
      );
      return { ...t, projectId: match?.id ?? null };
    })
    .sort((a, b) => b.activity - a.activity);
}
