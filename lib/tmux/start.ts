import { execFile } from "child_process";
import { promisify } from "util";
import { createProgramFeed, ownedSessions } from "../program-status/tap";
import { dropProgramTransient, programSessions } from "../program-status/store";
import { notifyStatusChanged } from "../status/hub";
import { statusDetector } from "../status-detector";
import { ControlManager, setControlManager, spawnTmux } from "./control";

const execFileAsync = promisify(execFile);
const SAFETY_MS = 15_000;

// attach-session -f read-only,ignore-size is tmux 3.2's.
export function controlModeSupported(version: string): boolean {
  const m = /tmux (?:next-)?(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > 3 || (major === 3 && minor >= 2);
}

/**
 * Watches every local session this AgentOS runs through tmux control mode
 * (lib/tmux/control.ts). Null when tmux is too old or AGENTOS_TMUX_CONTROL
 * is "off": the caller falls back to pipe-pane taps and screen captures.
 */
export async function startTmuxControl(): Promise<{
  rescan: () => void;
} | null> {
  if (process.env.AGENTOS_TMUX_CONTROL === "off") return null;
  try {
    const { stdout } = await execFileAsync("tmux", ["-V"], { timeout: 5000 });
    if (!controlModeSupported(stdout)) return null;
  } catch {
    return null;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const sync = () => {
    const owned = ownedSessions();
    const local = statusDetector
      .cachedSessions()
      .filter((s) => s.hostId === "local");
    manager.sync(local.filter((s) => owned.has(s.name)).map((s) => s.name));
    // A session that ended took its program with it.
    const alive = new Set(local.map((s) => s.name));
    let changed = false;
    for (const name of programSessions())
      if (!alive.has(name) && dropProgramTransient(name)) changed = true;
    if (changed) notifyStatusChanged();
  };
  const soon = () => {
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      await statusDetector.refreshCache().catch(() => {});
      sync();
    }, 300);
  };
  const manager = new ControlManager({
    spawn: spawnTmux,
    feed: createProgramFeed,
    sessionsChanged: () => {
      statusDetector.invalidateLocal();
      soon();
    },
    attached: (name) => {
      // A pipe-pane tap from before writes to a socket nobody reads now.
      void execFileAsync("tmux", ["pipe-pane", "-t", `=${name}:`], {
        timeout: 5000,
      }).catch(() => {});
      // What it reported while nobody watched is lost: a saved working or
      // blocked may be stale, so the screen decides until it reports again.
      if (dropProgramTransient(name)) notifyStatusChanged();
    },
    detached: (name) => {
      if (dropProgramTransient(name)) notifyStatusChanged();
    },
    now: Date.now,
  });
  setControlManager(manager);
  statusDetector.onRefresh(sync);
  // Sessions come and go with %sessions-changed; this only catches what a
  // missed notice would leave behind.
  setInterval(() => {
    void statusDetector
      .refreshCache()
      .catch(() => {})
      .then(sync);
  }, SAFETY_MS).unref?.();
  soon();
  return {
    rescan: () => {
      statusDetector.invalidateLocal();
      soon();
    },
  };
}
