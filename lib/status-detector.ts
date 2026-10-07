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
  /[>❯]\s*1\.\s*Yes/,
  // Claude Code's permission prompt, whose options can wrap past the window.
  /Esc to cancel · Tab to amend/,
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

interface UnsentTracker {
  text: string;
  since: number;
  shown: boolean;
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

// Typed text left in an input box this long is a message that never got
// sent; anything newer may still be being typed.
export const UNSENT_MS = 60000;

// What a screen says it needs from you: a question to answer from a menu,
// or text typed at the prompt and never sent.
export interface ScreenNeed {
  need: "answer" | "unsent";
  detail: string;
}

const ESCAPE =
  // CSI, OSC (BEL or ST ended), and two-byte escapes.
  /\x1b(?:\[([0-9;:?]*)([@-~])|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

// The text of a screen captured with its colours (tmux capture-pane -e),
// dropping what's drawn dim when asked: Claude Code and Codex draw their
// placeholder and suggested next prompt dim, in the same box as typed text.
export function plainText(screen: string, { dropDim = false } = {}): string {
  if (!dropDim) return screen.replace(ESCAPE, "");
  let out = "";
  let dim = false;
  let last = 0;
  for (const m of screen.matchAll(ESCAPE)) {
    if (!dim) out += screen.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[2] !== "m") continue;
    for (const p of (m[1] || "0").split(/[;:]/)) {
      if (p === "2") dim = true;
      else if (p === "" || p === "0" || p === "22") dim = false;
    }
  }
  if (!dim) out += screen.slice(last);
  return out;
}

const clip = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

const BORDER = /^\s*─{8,}\s*$/;
const SELECTED_OPTION = /^\s*[❯›>]\s*\d+\.\s+\S/;
const OPTION = /^\s*(?:[❯›>]\s*)?(\d+)\.\s+(\S.*)$/;
// "Enter to select · ↑/↓ to navigate · Esc to cancel" (Claude Code), "enter
// to confirm", "enter continue · esc quit" (Codex).
const MENU_FOOTER = /enter (?:to )?(?:select|confirm|continue|submit)|↑\/↓/i;
// A tab row or a "☐ Header" above a Claude Code question.
const MENU_HEADER = /^\s*(?:[☐☒✔←→]|☐)/;

/**
 * The question an active selection menu asks, when the bottom of the screen
 * is one: a numbered list with a selected option and a footer saying how to
 * pick. A permission prompt (its first option "Yes") is not a question.
 */
export function findQuestion(screen: string): string | null {
  const lines = plainText(screen).replace(/\s+$/, "").split("\n").slice(-30);
  const tail = lines.filter((l) => l.trim()).slice(-4);
  if (!tail.some((l) => MENU_FOOTER.test(l))) return null;
  if (!lines.some((l) => SELECTED_OPTION.test(l))) return null;
  const first = lines.findIndex((l) => OPTION.exec(l)?.[1] === "1");
  if (first < 0) return null;
  if (/^yes\b/i.test(OPTION.exec(lines[first])?.[2] ?? "")) return null;
  // The paragraph just above the options.
  const block: string[] = [];
  let i = first - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  for (; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim() || BORDER.test(line) || MENU_HEADER.test(line)) break;
    block.unshift(line.trim().replace(/^│\s*|\s*│$/g, ""));
  }
  return block.join(" ").trim() || "Choose an option";
}

/**
 * What's typed into a Claude Code or Codex input box: Claude's "❯" line
 * between two rules, or Codex's "›" line at the bottom, with their wrapped
 * lines. "" for an empty box, null when the screen shows none. Dim text
 * there is a placeholder or a suggestion, not something typed.
 */
export function readInputBox(screen: string): string | null {
  const lines = plainText(screen, { dropDim: true })
    .replace(/\s+$/, "")
    .split("\n")
    .slice(-20);
  const typed = (prompt: number, end: number) =>
    [lines[prompt].replace(/^\s*[❯›]\s?/, ""), ...lines.slice(prompt + 1, end)]
      .map((l) => l.replace(/\u00a0/g, " ").trim())
      .join(" ")
      .trim();

  // Claude Code: a rule, "❯ text", wrapped lines, a rule.
  for (let i = lines.length - 1; i > 0; i--) {
    if (!/^\s*❯/.test(lines[i]) || !BORDER.test(lines[i - 1])) continue;
    const end = lines.findIndex((l, j) => j > i && BORDER.test(l));
    return end < 0 ? null : typed(i, end);
  }

  // Codex: "› text", wrapped lines, a blank line, at most two footer lines.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/^›/.test(lines[i])) continue;
    if (SELECTED_OPTION.test(lines[i])) return null;
    let end = i + 1;
    while (end < lines.length && /^ {2}\S/.test(lines[end])) end++;
    if (end < lines.length && lines[end].trim()) return null;
    if (lines.slice(end).filter((l) => l.trim()).length > 2) return null;
    return typed(i, end);
  }
  return null;
}

class SessionStatusDetector {
  private trackers = new Map<string, StateTracker>();
  private unsent = new Map<string, UnsentTracker>();
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

  // The visible pane with its colours, for screenNeed and getStatus.
  async captureScreen(name: string): Promise<string> {
    try {
      const { stdout } = await hostExec(
        this.hostFor(name),
        `tmux capture-pane -e -t "=${name}:" -p 2>/dev/null || echo ""`
      );
      return stdout.trimEnd();
    } catch {
      return "";
    }
  }

  /**
   * What the screen says the session needs from you. A question menu counts
   * at once; typed text only once it has sat unchanged for UNSENT_MS, so
   * text still being typed doesn't. Not while the program works or waits
   * on something else.
   */
  screenNeed(
    name: string,
    screen: string,
    { question = true } = {},
    now = Date.now()
  ): ScreenNeed | null {
    const text = plainText(screen).trim();
    const asked = question ? findQuestion(screen) : null;
    const typed =
      asked === null &&
      !checkBusyIndicators(text) &&
      !checkWaitingPatterns(text)
        ? readInputBox(screen)
        : null;
    if (!typed) this.unsent.delete(name);
    if (asked !== null) return { need: "answer", detail: clip(asked, 200) };
    if (!typed) return null;
    const seen = this.unsent.get(name);
    if (!seen || seen.text !== typed) {
      this.unsent.set(name, { text: typed, since: now, shown: false });
      return null;
    }
    if (now - seen.since < UNSENT_MS) return null;
    seen.shown = true;
    return { need: "unsent", detail: clip(typed, 120) };
  }

  clearUnsent(name: string): void {
    this.unsent.delete(name);
  }

  /** Typed text that has just become unsent, and isn't shown yet. */
  unsentDue(now = Date.now()): boolean {
    for (const u of this.unsent.values())
      if (!u.shown && now - u.since >= UNSENT_MS) return true;
    return false;
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

  async getStatus(
    sessionName: string,
    screen?: string
  ): Promise<SessionStatus> {
    await this.refreshCache();

    // Dead check
    if (!this.sessionExists(sessionName)) {
      this.trackers.delete(sessionName);
      return "dead";
    }

    const timestamp = this.getTimestamp(sessionName);
    const tracker = this.getTracker(sessionName, timestamp);
    const content =
      screen === undefined
        ? await this.capturePane(sessionName)
        : plainText(screen).trim();

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
    for (const name of this.unsent.keys()) {
      if (!this.sessionExists(name)) this.unsent.delete(name);
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
