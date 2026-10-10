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

import { hostExecFile, listHosts } from "./hosts";
import { WORKING_LINE } from "./claude-working-line";
import { controlManager } from "./tmux/control";
import { isValidTmuxName } from "./hosts/attach";
import { hostLink } from "./hosts/remote-api";
import { peerTmuxSessions } from "./hosts/peer-sessions";

// Configuration constants
const CONFIG = {
  ACTIVITY_COOLDOWN_MS: 2000, // Grace period after activity
  // A screen with no new output is read again at least this often anyway.
  SCREEN_MAX_AGE_MS: 30000,
  SPIKE_WINDOW_MS: 1000, // Window to detect sustained activity
  SUSTAINED_THRESHOLD: 2, // Changes needed to confirm activity
  CACHE_VALIDITY_MS: 2000, // How long tmux cache is valid
  // This machine's listing while control clients watch its sessions: their
  // output, titles and screens arrive pushed, and a session created or
  // destroyed says so (%sessions-changed), so the listing is only for
  // what's left (the foreground program, sessions nobody watches).
  WATCHED_CACHE_MS: 10000,
  RECENT_ACTIVITY_MS: 120000, // Window for "recent" activity (2 min, tmux updates slowly)
} as const;

// Detection patterns
const BUSY_INDICATORS = [
  "esc to interrupt",
  "(esc to interrupt)",
  "· esc to interrupt",
  // OpenCode's footer while it works.
  "esc interrupt",
];

const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const SPINNER_LABEL = new RegExp(`(?:${SPINNER_CHARS.join("|")}) [A-Z][a-z]+`);

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
  /[>❯›]\s*1\.\s*Yes/,
  // OpenCode's permission prompt.
  /Permission required/,
  /Allow once\s+Allow always\s+Reject/,
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
  // When the active window last printed (session activity moves only on
  // keys from a client, not on output).
  output: number;
  path: string;
  attached: boolean;
  windows: number;
  // The active pane's foreground program.
  command: string;
  // The active pane's title; Claude Code writes its state and task there.
  title: string;
  // The active pane's process (its shell), to see what runs under it.
  pid: number;
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
  "#{session_name}\t#{session_activity}\t#{window_activity}\t#{session_path}\t#{session_attached}\t#{session_windows}\t#{pane_current_command}\t#{pane_pid}\t#{pane_title}";

// Sessions are told apart by machine and name: two machines may each have
// a "main", and neither hides the other.
export const sessionKey = (hostId: string, name: string) =>
  `${hostId}\t${name}`;

async function listHostSessions(hostId: string): Promise<TmuxSessionInfo[]> {
  const { stdout } = await hostExecFile(
    hostId,
    "tmux",
    ["list-sessions", "-F", LIST_FORMAT],
    8000
  ).catch(listingFailure);
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [
        name,
        activity,
        output,
        path,
        attached,
        windows,
        command,
        pid,
        ...title
      ] = line.split("\t");
      return {
        name,
        hostId,
        activity: parseInt(activity, 10) || 0,
        output: parseInt(output, 10) || 0,
        path: path || "",
        attached: attached !== "0" && !!attached,
        windows: parseInt(windows, 10) || 1,
        command: command || "",
        pid: parseInt(pid, 10) || 0,
        title: title.join("\t"),
      };
    });
}

/**
 * Whether a screen read earlier still shows the pane. tmux's output time
 * (window_activity) is in whole seconds, so it holds only when: the listing
 * that gave `output` began after the read did (output since then would have
 * moved it), it hasn't moved, the read began after that second ended, and
 * the read isn't older than SCREEN_MAX_AGE_MS.
 */
export function screenStillFresh(
  cached: { output: number; at: number },
  output: number,
  listedAt: number,
  now: number
): boolean {
  return (
    output > 0 &&
    cached.output === output &&
    listedAt >= cached.at &&
    cached.at >= (output + 1) * 1000 &&
    now - cached.at < CONFIG.SCREEN_MAX_AGE_MS
  );
}

// tmux list-sessions failing: no server yet is an empty list. Anything else
// (tmux couldn't start, a timeout, ssh's own failure) is the host's error,
// and the last listing stands.
const NO_SERVER =
  /no server running|error connecting|no such file or directory/i;

export function listingFailure(err: {
  stdout?: string;
  stderr?: string;
  killed?: boolean;
  code?: unknown;
}): { stdout: string } {
  if (
    !err.killed &&
    typeof err.code === "number" &&
    err.code !== 255 &&
    NO_SERVER.test(err.stderr ?? "")
  )
    return { stdout: "" };
  throw err;
}

// Content analysis helpers

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

  // A spinner labelling what it does ("⠋ Working...", "⠹ Thinking") sits
  // above the input box and footer in Pi and OpenCode.
  if (SPINNER_LABEL.test(lines.slice(-14).join("\n"))) return true;

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

// What the last-lines checks read: a pane's blank bottom rows would push the
// prompt out of their window.
export const screenText = (screen: string) => plainText(screen).trim();

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
  private screens = new Map<
    string,
    { output: number; at: number; text: string }
  >();
  private cache: SessionCache = {
    data: new Map(),
    hostErrors: new Map(),
    listedAt: 0,
    updatedAt: 0,
  };

  // When each machine was last listed.
  private hostListedAt = new Map<string, number>();
  private refreshing: Promise<void> | null = null;
  // Linked machines being asked right now (see refreshPeer).
  private peersAsked = new Set<string>();
  private refreshed = new Set<() => void>();

  // One list-sessions per machine that's due, in parallel; the others keep
  // what they had. An unreachable machine keeps its last known sessions so
  // a network blip doesn't mark them dead.
  async refreshCache(): Promise<void> {
    if (Date.now() - this.cache.updatedAt < CONFIG.CACHE_VALIDITY_MS) return;
    this.refreshing ??= this.list().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async list(): Promise<void> {
    const listedAt = Date.now();
    const watched = (controlManager()?.size() ?? 0) > 0;
    const due = listHosts().filter((h) => {
      const last = this.hostListedAt.get(h.id) ?? 0;
      const every =
        h.id === "local" && watched
          ? CONFIG.WATCHED_CACHE_MS
          : CONFIG.CACHE_VALIDITY_MS;
      return listedAt - last >= every;
    });
    // A linked machine's AgentOS lists its own sessions, in the background:
    // a slow one, or one that's asking this machine back, never holds up
    // this listing. ssh is for the rest.
    const hosts = due.filter((h) => {
      const link = hostLink(h.id);
      if (link) this.refreshPeer(link);
      return !link;
    });
    const results = await Promise.allSettled(
      hosts.map((h) => listHostSessions(h.id))
    );

    const fresh = new Set(hosts.map((h) => h.id));
    const data = new Map<string, TmuxSessionInfo>();
    for (const info of this.cache.data.values())
      if (!fresh.has(info.hostId))
        data.set(sessionKey(info.hostId, info.name), info);
    const hostErrors = new Map(
      [...this.cache.hostErrors].filter(([id]) => !fresh.has(id))
    );
    results.forEach((result, i) => {
      const hostId = hosts[i].id;
      this.hostListedAt.set(hostId, listedAt);
      if (result.status === "fulfilled") {
        for (const info of result.value)
          data.set(sessionKey(info.hostId, info.name), info);
        return;
      }
      hostErrors.set(hostId, String(result.reason?.message || result.reason));
      for (const info of this.cache.data.values()) {
        if (info.hostId === hostId)
          data.set(sessionKey(info.hostId, info.name), info);
      }
    });

    this.cache = {
      data,
      hostErrors,
      listedAt: hosts.length ? listedAt : this.cache.listedAt,
      updatedAt: Date.now(),
    };
    if (hosts.length) for (const fn of this.refreshed) fn();
  }

  private refreshPeer(link: NonNullable<ReturnType<typeof hostLink>>): void {
    const hostId = link.hostId;
    if (this.peersAsked.has(hostId)) return;
    this.peersAsked.add(hostId);
    this.hostListedAt.set(hostId, Date.now());
    void peerTmuxSessions(link)
      .then(
        (list) => {
          const data = new Map(
            [...this.cache.data].filter(([, i]) => i.hostId !== hostId)
          );
          for (const info of list)
            data.set(sessionKey(info.hostId, info.name), info);
          const hostErrors = new Map(this.cache.hostErrors);
          hostErrors.delete(hostId);
          this.cache = { ...this.cache, data, hostErrors };
        },
        (err) => {
          // Its last known sessions stand; the error says why they're old.
          const hostErrors = new Map(this.cache.hostErrors);
          hostErrors.set(hostId, String(err?.message || err));
          this.cache = { ...this.cache, hostErrors };
        }
      )
      .finally(() => {
        this.peersAsked.delete(hostId);
        for (const fn of this.refreshed) fn();
      });
  }

  /** The next refresh lists this machine again (a session came or went). */
  invalidateLocal(): void {
    this.hostListedAt.delete("local");
    this.cache.updatedAt = 0;
  }

  /** Called after each listing, for what follows the set of sessions. */
  onRefresh(fn: () => void): () => void {
    this.refreshed.add(fn);
    return () => this.refreshed.delete(fn);
  }

  // A session by name on a machine; with no machine given, this one's
  // first, then any (callers that only know a name mean a local session).
  private info(name: string, hostId?: string): TmuxSessionInfo | undefined {
    if (hostId) return this.cache.data.get(sessionKey(hostId, name));
    return (
      this.cache.data.get(sessionKey("local", name)) ??
      [...this.cache.data.values()].find((i) => i.name === name)
    );
  }

  private hostOf(name: string, hostId?: string): string {
    return this.info(name, hostId)?.hostId ?? hostId ?? "local";
  }

  private keyOf(name: string, hostId?: string): string {
    return sessionKey(this.hostOf(name, hostId), name);
  }

  // This machine's tmux control client knows only this machine's sessions.
  private control(name: string, hostId?: string) {
    return this.hostOf(name, hostId) === "local" ? controlManager() : null;
  }

  paneProcess(name: string, hostId?: string): number | undefined {
    return this.info(name, hostId)?.pid || undefined;
  }

  sessionExists(name: string, hostId?: string): boolean {
    return !!this.info(name, hostId);
  }

  getTimestamp(name: string, hostId?: string): number {
    return this.info(name, hostId)?.activity || 0;
  }

  titleFor(name: string, hostId?: string): string {
    return (
      this.control(name, hostId)?.title(name) ||
      this.info(name, hostId)?.title ||
      ""
    );
  }

  listedAt(): number {
    return this.cache.listedAt;
  }

  foregroundFor(name: string, hostId?: string): string | undefined {
    return this.info(name, hostId)?.command;
  }

  // Changes whenever any session's output, title or program does, so a
  // caller can tell if anything is worth looking at again.
  signature(): string {
    return [...this.cache.data.values()]
      .map(
        (i) =>
          `${i.hostId}:${i.name}:${i.activity}:${i.command}:${this.titleFor(i.name, i.hostId)}`
      )
      .join("\n");
  }

  hostFor(name: string): string | undefined {
    return this.info(name)?.hostId;
  }

  async listSessions(): Promise<TmuxSessionInfo[]> {
    await this.refreshCache();
    return [...this.cache.data.values()];
  }

  // What the last list-sessions found, without asking tmux again.
  cachedSessions(): TmuxSessionInfo[] {
    return [...this.cache.data.values()];
  }

  hostErrors(): Record<string, string> {
    return Object.fromEntries(this.cache.hostErrors);
  }

  // tmux run directly (no shell); "" when the pane is gone.
  private async capture(
    name: string,
    colours: boolean,
    hostId?: string
  ): Promise<string> {
    // A linked machine's screens are its AgentOS's to read, not ssh's.
    const host = this.hostOf(name, hostId);
    if (hostLink(host)) return "";
    try {
      const { stdout } = await hostExecFile(host, "tmux", [
        "capture-pane",
        ...(colours ? ["-e"] : []),
        "-t",
        `=${name}:`,
        "-p",
      ]);
      return stdout;
    } catch {
      return "";
    }
  }

  // What's on screen now, read from tmux itself: what a gate decides on
  // (a BLOCKED: line) is never the kept copy. A watched session is asked
  // over its control client, so this still starts no process.
  async capturePane(name: string, hostId?: string): Promise<string> {
    const asked = await this.control(name, hostId)?.query(
      name,
      `capture-pane -p -t =${name}:`
    );
    if (asked) return asked.join("\n").trim();
    return (await this.capture(name, false, hostId)).trim();
  }

  // The visible pane with its colours, for screenNeed and getStatus; read
  // again only when it may have changed (screenStillFresh), or always when
  // `fresh` (a reported question is being checked against the screen).
  async captureScreen(
    name: string,
    fresh = false,
    hostId?: string
  ): Promise<string> {
    const control = this.control(name, hostId);
    const key = this.keyOf(name, hostId);
    // Kept from the pane's own output by its control client: as current as
    // a capture, at no cost. Asked to be fresh (a reported question checked
    // against the screen), it's read from tmux, over the client if watched.
    if (!fresh) {
      const live = control?.screen(name);
      if (live != null) return live.trimEnd();
    } else if (isValidTmuxName(name)) {
      const asked = await control?.query(
        name,
        `capture-pane -e -p -t =${name}:`
      );
      if (asked) return asked.join("\n").trimEnd();
    }
    const output = this.info(name, hostId)?.output ?? 0;
    const cached = this.screens.get(key);
    const now = Date.now();
    // Its control client saw nothing printed since that read: it holds.
    if (!fresh && cached && control?.printedSince(name, cached.at) === false)
      return cached.text;
    if (
      !fresh &&
      cached &&
      screenStillFresh(cached, output, this.cache.listedAt, now)
    )
      return cached.text;
    const text = (await this.capture(name, true, hostId)).trimEnd();
    this.screens.set(key, { output, at: now, text });
    return text;
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
    { question = true, hostId }: { question?: boolean; hostId?: string } = {},
    now = Date.now()
  ): ScreenNeed | null {
    const key = this.keyOf(name, hostId);
    const text = screenText(screen);
    const asked = question ? findQuestion(screen) : null;
    const typed =
      asked === null &&
      !checkBusyIndicators(text) &&
      !checkWaitingPatterns(text)
        ? readInputBox(screen)
        : null;
    if (!typed) this.unsent.delete(key);
    if (asked !== null) return { need: "answer", detail: clip(asked, 200) };
    if (!typed) return null;
    const seen = this.unsent.get(key);
    if (!seen || seen.text !== typed) {
      this.unsent.set(key, { text: typed, since: now, shown: false });
      return null;
    }
    if (now - seen.since < UNSENT_MS) return null;
    seen.shown = true;
    return { need: "unsent", detail: clip(typed, 120) };
  }

  clearUnsent(name: string, hostId?: string): void {
    this.unsent.delete(this.keyOf(name, hostId));
  }

  /** Typed text that has just become unsent, and isn't shown yet. */
  unsentDue(now = Date.now()): boolean {
    for (const u of this.unsent.values())
      if (!u.shown && now - u.since >= UNSENT_MS) return true;
    return false;
  }

  private getTracker(key: string, timestamp: number): StateTracker {
    let tracker = this.trackers.get(key);
    if (!tracker) {
      tracker = {
        lastChangeTime: Date.now() - CONFIG.ACTIVITY_COOLDOWN_MS,
        acknowledged: true,
        lastActivityTimestamp: timestamp,
        spikeWindowStart: null,
        spikeChangeCount: 0,
      };
      this.trackers.set(key, tracker);
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
    screen?: string,
    hostId?: string
  ): Promise<SessionStatus> {
    await this.refreshCache();
    const key = this.keyOf(sessionName, hostId);

    // Dead check
    if (!this.sessionExists(sessionName, hostId)) {
      this.trackers.delete(key);
      return "dead";
    }

    const timestamp = this.getTimestamp(sessionName, hostId);
    const tracker = this.getTracker(key, timestamp);
    const content =
      screen === undefined
        ? await this.capturePane(sessionName, hostId)
        : screenText(screen);

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

  acknowledge(sessionName: string, hostId?: string): void {
    const tracker = this.trackers.get(this.keyOf(sessionName, hostId));
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
    for (const map of [this.trackers, this.unsent, this.screens])
      for (const key of map.keys())
        if (!this.cache.data.has(key)) map.delete(key);
  }
}

// One per process: the custom server's push and the Next.js routes share
// its trackers and cache.
const g = globalThis as unknown as {
  __agentosStatusDetector?: SessionStatusDetector;
};
export const statusDetector = (g.__agentosStatusDetector ??=
  new SessionStatusDetector());
