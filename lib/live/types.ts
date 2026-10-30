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
  kind: "kick" | "admit" | "deny";
  label: string;
}

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
}

export interface LiveResponse {
  linked: boolean;
  shares: LiveView[];
  /** Only when the request named a session. */
  invite?: LiveInvite;
}
