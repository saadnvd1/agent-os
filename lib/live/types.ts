export type LiveLevel = "watch" | "suggest" | "drive";

/** The single source for what each level is called and what it lets a guest do. */
export const LEVELS: Record<LiveLevel, { label: string; hint: string }> = {
  watch: {
    label: "Watch",
    hint: "Guests only watch. They can't send you anything.",
  },
  suggest: {
    label: "Suggest",
    hint: "Guests can suggest a prompt. Nothing reaches the agent unless you tap Send.",
  },
  drive: {
    label: "Drive",
    hint: "Guests can make the agent read this task's files. Everything else waits for you.",
  },
};

export interface LevelOption {
  value: LiveLevel;
  label: string;
  hint: string;
  enabled: boolean;
  reason?: string;
}

export interface GuestAction {
  kind: "kick" | "admit" | "admit_drive" | "deny" | "give_wheel" | "take_back";
  label: string;
}

export type CodeActionKind =
  "copy" | "copy_link" | "new_code" | "set_code" | "code_off" | "code_on";

/** The access code as the host's screens show it; built on the machine. */
export interface LiveCodeView {
  on: boolean;
  /** "482-917", or the host's own code in capitals. Null when off. */
  display: string | null;
  /** The link and the code on two lines, for one paste. Null when off. */
  copyText: string | null;
  label: string;
  hint: string;
  /** Set after too many wrong tries; a code change clears it. */
  notice: string | null;
  /** For "Use my own". */
  prompt: { title: string; message: string; placeholder: string };
  actions: { kind: CodeActionKind; label: string }[];
}

export type DriverState = "idle" | "queued" | "working" | "waiting_on_host";

// What the host's screens show of a live share (served by /api/live-shares).
export interface LiveView {
  id: string;
  sessionId: string;
  title: string;
  url: string;
  expiresAt: string | null;
  endsWithSession: boolean;
  maxGuests: number;
  connected: boolean;
  notice: string | null;
  level: LiveLevel;
  levels: LevelOption[];
  /** Whether the guests got the chat from before the link was made. */
  history: boolean;
  code: LiveCodeView;
  /** The guest holding the wheel on a Drive share. */
  driver: { guestId: string; name: string; state: DriverState } | null;
  /** Shown above the composer while a guest drives. */
  banner: {
    text: string;
    action?: { kind: "take_back"; label: string };
  } | null;
  guests: {
    id: string;
    name: string;
    status: "pending" | "admitted";
    online: boolean;
    /** Another guest here has the same name. */
    duplicateName: boolean;
    actions: GuestAction[];
  }[];
  suggestions: {
    id: string;
    guestId: string;
    guestName: string;
    text: string;
    at: number;
  }[];
}

export type LiveExpiry = "1h" | "session";

export const EXPIRY_LABEL: Record<LiveExpiry, string> = {
  "1h": "1 hour",
  session: "Until the session ends",
};

export interface LiveInvite {
  levels: LevelOption[];
  history: { label: string; default: boolean; count: number };
  code: {
    default: boolean;
    label: string;
    hint: string;
    customLabel: string;
    rules: string;
  };
}

export interface LiveResponse {
  linked: boolean;
  shares: LiveView[];
  /** Only when the request named a session. */
  invite?: LiveInvite;
}
