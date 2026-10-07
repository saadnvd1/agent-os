/**
 * Session Status Detection System
 *
 * States:
 * - "running" (GREEN): Sustained activity within cooldown period
 * - "waiting" (YELLOW): Cooldown expired, NOT acknowledged (needs attention)
 * - "idle" (GRAY): Cooldown expired, acknowledged (user saw it)
 * - "dead": Session doesn't exist
 *
 * Detection Strategy:
 * 1. Busy indicators + recent activity (highest priority - actively working)
 * 2. Waiting patterns - user input needed
 * 3. Spike detection - activity timestamp changes (2+ in 1s = sustained)
 * 4. Cooldown - 2s grace period after activity stops
 */

import { hostExec, listHosts } from "./hosts";

// Configuration constants
const CONFIG = {
  ACTIVITY_COOLDOWN_MS: 2000, // Grace period after activity
  SPIKE_WINDOW_MS: 1000, // Window to detect sustained activity
  SUSTAINED_THRESHOLD: 2, // Changes needed to confirm activity
  CACHE_VALIDITY_MS: 2000, // How long tmux cache is valid
  RECENT_ACTIVITY_MS: 120000, // Window for "recent" activity (2 min, tmux updates slowly)
} as const;

// Detection patterns
const BUSY_INDICATORS = [
  "esc to interrupt",
  "(esc to interrupt)",
  "· esc to interrupt",
];

const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const WHIMSICAL_WORDS = [
  "accomplishing",
  "actioning",
  "actualizing",
  "baking",
  "booping",
  "brewing",
  "calculating",
  "cerebrating",
  "channelling",
  "churning",
  "clauding",
  "coalescing",
  "cogitating",
  "combobulating",
  "computing",
  "concocting",
  "conjuring",
  "considering",
  "contemplating",
  "cooking",
  "crafting",
  "creating",
  "crunching",
  "deciphering",
  "deliberating",
  "determining",
  "discombobulating",
  "divining",
  "doing",
  "effecting",
  "elucidating",
  "enchanting",
  "envisioning",
  "finagling",
  "flibbertigibbeting",
  "forging",
  "forming",
  "frolicking",
  "generating",
  "germinating",
  "hatching",
  "herding",
  "honking",
  "hustling",
  "ideating",
  "imagining",
  "incubating",
  "inferring",
  "jiving",
  "manifesting",
  "marinating",
  "meandering",
  "moseying",
  "mulling",
  "mustering",
  "musing",
  "noodling",
  "percolating",
  "perusing",
  "philosophising",
  "pondering",
  "pontificating",
  "processing",
  "puttering",
  "puzzling",
  "reticulating",
  "ruminating",
  "scheming",
  "schlepping",
  "shimmying",
  "shucking",
  "simmering",
  "smooshing",
  "spelunking",
  "spinning",
  "stewing",
  "sussing",
  "synthesizing",
  "thinking",
  "tinkering",
  "transmuting",
  "unfurling",
  "unravelling",
  "vibing",
  "wandering",
  "whirring",
  "wibbling",
  "wizarding",
  "working",
  "wrangling",
];

const WAITING_PATTERNS = [
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /Allow\?/i,
  /Approve\?/i,
  /Continue\?/i,
  /Press Enter to/i,
  /waiting for input/i,
  /\(yes\/no\)/i,
  /Do you want to/i,
  /Enter to confirm.*Esc to cancel/i,
  />\s*1\.\s*Yes/,
  /Yes, allow all/i,
  /allow all edits/i,
  /allow all commands/i,
];

export type SessionStatus = "running" | "waiting" | "idle" | "dead";

interface StateTracker {
  lastChangeTime: number;
  acknowledged: boolean;
  lastActivityTimestamp: number;
  spikeWindowStart: number | null;
  spikeChangeCount: number;
}

export interface TmuxSessionInfo {
  name: string;
  hostId: string;
  activity: number;
  path: string;
  attached: boolean;
  windows: number;
  // The active pane's foreground program.
  command: string;
  // The active pane's title; Claude Code writes its state and task there.
  title: string;
}

interface SessionCache {
  data: Map<string, TmuxSessionInfo>;
  hostErrors: Map<string, string>;
  // When the listing behind data began.
  listedAt: number;
  updatedAt: number;
}

const LIST_FORMAT =
  "#{session_name}\t#{session_activity}\t#{session_path}\t#{session_attached}\t#{session_windows}\t#{pane_current_command}\t#{pane_title}";

async function listHostSessions(hostId: string): Promise<TmuxSessionInfo[]> {
  const { stdout } = await hostExec(
    hostId,
    `tmux list-sessions -F '${LIST_FORMAT}' 2>/dev/null || true`,
    8000
  );
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, activity, path, attached, windows, command, ...title] =
        line.split("\t");
      return {
        name,
        hostId,
        activity: parseInt(activity, 10) || 0,
        path: path || "",
        attached: attached !== "0" && !!attached,
        windows: parseInt(windows, 10) || 1,
        command: command || "",
        title: title.join("\t"),
      };
    });
}

// Content analysis helpers
// Claude Code's working line, whatever word it picks: "✻ Composing… (4m 0s ·
// ↓ 23.5k tokens)". It sits above the input box and status line, so it can be
// several lines up from the bottom.
const WORKING_LINE = /^\s*\S\s+[A-Z][a-z]+(?:ing)?…\s+\(\d+[smh]?\b/m;

export function checkBusyIndicators(content: string): boolean {
  const lines = content.split("\n");
  if (WORKING_LINE.test(lines.slice(-12).join("\n"))) return true;
  // Focus on last 10 lines to avoid old scrollback false positives
  const recentContent = lines.slice(-10).join("\n").toLowerCase();

  // Check text indicators in recent lines
  if (BUSY_INDICATORS.some((ind) => recentContent.includes(ind))) return true;

  // Check whimsical words + "tokens" pattern in recent lines
  if (
    recentContent.includes("tokens") &&
    WHIMSICAL_WORDS.some((w) => recentContent.includes(w))
  )
    return true;

  // Check spinners in last 5 lines
  const last5 = lines.slice(-5).join("");
  if (SPINNER_CHARS.some((s) => last5.includes(s))) return true;

  return false;
}

export function checkWaitingPatterns(content: string): boolean {
  const recentLines = content.split("\n").slice(-5).join("\n");
  return WAITING_PATTERNS.some((p) => p.test(recentLines));
}

class SessionStatusDetector {
  private trackers = new Map<string, StateTracker>();
  private cache: SessionCache = {
    data: new Map(),
    hostErrors: new Map(),
    listedAt: 0,
    updatedAt: 0,
  };

  // One list-sessions per machine, in parallel. An unreachable machine keeps
  // its last known sessions so a network blip doesn't mark them dead.
  async refreshCache(): Promise<void> {
    if (Date.now() - this.cache.updatedAt < CONFIG.CACHE_VALIDITY_MS) return;

    const listedAt = Date.now();
    const hosts = listHosts();
    const results = await Promise.allSettled(
      hosts.map((h) => listHostSessions(h.id))
    );

    const data = new Map<string, TmuxSessionInfo>();
    const hostErrors = new Map<string, string>();
    results.forEach((result, i) => {
      const hostId = hosts[i].id;
      if (result.status === "fulfilled") {
        for (const info of result.value) data.set(info.name, info);
        return;
      }
      hostErrors.set(hostId, String(result.reason?.message || result.reason));
      for (const info of this.cache.data.values()) {
        if (info.hostId === hostId) data.set(info.name, info);
      }
    });

    this.cache = { data, hostErrors, listedAt, updatedAt: Date.now() };
  }

  sessionExists(name: string): boolean {
    return this.cache.data.has(name);
  }

  getTimestamp(name: string): number {
    return this.cache.data.get(name)?.activity || 0;
  }

  titleFor(name: string): string {
    return this.cache.data.get(name)?.title ?? "";
  }

  listedAt(): number {
    return this.cache.listedAt;
  }

  foregroundFor(name: string): string | undefined {
    return this.cache.data.get(name)?.command;
  }

  // Changes whenever any session's output, title or program does, so a
  // caller can tell if anything is worth looking at again.
  signature(): string {
    return [...this.cache.data.values()]
      .map((i) => `${i.name}:${i.activity}:${i.command}:${i.title}`)
      .join("\n");
  }

  hostFor(name: string): string | undefined {
    return this.cache.data.get(name)?.hostId;
  }

  async listSessions(): Promise<TmuxSessionInfo[]> {
    await this.refreshCache();
    return [...this.cache.data.values()];
  }

  hostErrors(): Record<string, string> {
    return Object.fromEntries(this.cache.hostErrors);
  }

  async capturePane(name: string): Promise<string> {
    try {
      const { stdout } = await hostExec(
        this.hostFor(name),
        `tmux capture-pane -t "=${name}:" -p 2>/dev/null || echo ""`
      );
      return stdout.trim();
    } catch {
      return "";
    }
  }

  private getTracker(name: string, timestamp: number): StateTracker {
    let tracker = this.trackers.get(name);
    if (!tracker) {
      tracker = {
        lastChangeTime: Date.now() - CONFIG.ACTIVITY_COOLDOWN_MS,
        acknowledged: true,
        lastActivityTimestamp: timestamp,
        spikeWindowStart: null,
        spikeChangeCount: 0,
      };
      this.trackers.set(name, tracker);
    }
    return tracker;
  }

  // Spike detection: filters single activity spikes from sustained activity
  private processSpikeDetection(
    tracker: StateTracker,
    currentTimestamp: number
  ): "running" | null {
    const now = Date.now();
    const timestampChanged = tracker.lastActivityTimestamp !== currentTimestamp;

    if (timestampChanged) {
      tracker.lastActivityTimestamp = currentTimestamp;

      const windowExpired =
        tracker.spikeWindowStart === null ||
        now - tracker.spikeWindowStart > CONFIG.SPIKE_WINDOW_MS;

      if (windowExpired) {
        // Start new detection window
        tracker.spikeWindowStart = now;
        tracker.spikeChangeCount = 1;
      } else {
        // Within window - count change
        tracker.spikeChangeCount++;
        if (tracker.spikeChangeCount >= CONFIG.SUSTAINED_THRESHOLD) {
          // Sustained activity confirmed
          tracker.lastChangeTime = now;
          tracker.acknowledged = false;
          tracker.spikeWindowStart = null;
          tracker.spikeChangeCount = 0;
          return "running";
        }
      }
    } else if (
      tracker.spikeChangeCount === 1 &&
      tracker.spikeWindowStart !== null
    ) {
      // Check if single spike should be filtered
      if (now - tracker.spikeWindowStart > CONFIG.SPIKE_WINDOW_MS) {
        tracker.spikeWindowStart = null;
        tracker.spikeChangeCount = 0;
      }
    }

    return null;
  }

  private isInSpikeWindow(tracker: StateTracker): boolean {
    return (
      tracker.spikeWindowStart !== null &&
      Date.now() - tracker.spikeWindowStart < CONFIG.SPIKE_WINDOW_MS
    );
  }

  private isInCooldown(tracker: StateTracker): boolean {
    return Date.now() - tracker.lastChangeTime < CONFIG.ACTIVITY_COOLDOWN_MS;
  }

  private getIdleOrWaiting(tracker: StateTracker): SessionStatus {
    return tracker.acknowledged ? "idle" : "waiting";
  }

  async getStatus(sessionName: string): Promise<SessionStatus> {
    await this.refreshCache();

    // Dead check
    if (!this.sessionExists(sessionName)) {
      this.trackers.delete(sessionName);
      return "dead";
    }

    const timestamp = this.getTimestamp(sessionName);
    const tracker = this.getTracker(sessionName, timestamp);
    const content = await this.capturePane(sessionName);

    // 1. Busy indicators in last 10 lines (highest priority - Claude is actively working)
    // No activity timestamp check needed since we only look at recent terminal lines
    if (checkBusyIndicators(content)) {
      tracker.lastChangeTime = Date.now();
      tracker.acknowledged = false;
      return "running";
    }

    // 2. Waiting patterns (only if not actively running)
    if (checkWaitingPatterns(content)) return "waiting";

    // 3. Spike detection
    const spikeResult = this.processSpikeDetection(tracker, timestamp);
    if (spikeResult) return spikeResult;

    // 4. During spike window, maintain stable status
    if (this.isInSpikeWindow(tracker)) {
      return this.isInCooldown(tracker)
        ? "running"
        : this.getIdleOrWaiting(tracker);
    }

    // 5. Cooldown check
    if (this.isInCooldown(tracker)) return "running";

    // 6. Cooldown expired
    return this.getIdleOrWaiting(tracker);
  }

  acknowledge(sessionName: string): void {
    const tracker = this.trackers.get(sessionName);
    if (tracker) tracker.acknowledged = true;
  }

  async getAllStatuses(names: string[]): Promise<Map<string, SessionStatus>> {
    await this.refreshCache();
    const results = await Promise.all(
      names.map(async (name) => ({ name, status: await this.getStatus(name) }))
    );
    return new Map(results.map((r) => [r.name, r.status]));
  }

  cleanup(): void {
    for (const [name] of this.trackers) {
      if (!this.sessionExists(name)) this.trackers.delete(name);
    }
  }
}

// One per process: the custom server's push and the Next.js routes share
// its trackers and cache.
const g = globalThis as unknown as {
  __agentosStatusDetector?: SessionStatusDetector;
};
export const statusDetector = (g.__agentosStatusDetector ??=
  new SessionStatusDetector());
