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
  guests: {
    id: string;
    name: string;
    status: "pending" | "admitted";
    online: boolean;
    /** Another guest here has the same name. */
    duplicateName: boolean;
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

export interface LiveResponse {
  linked: boolean;
  shares: LiveView[];
}
