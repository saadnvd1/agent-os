import type { ConnectStatus } from "./serve";

export const CONNECT_SITE = "https://runagentos.com";
export const CONNECT_SIGN_UP = `${CONNECT_SITE}/sign-in?mode=sign-up`;

export const CONNECT_STATE: Record<ConnectStatus["state"], string> = {
  up: "Connected",
  connecting: "Connecting…",
  denied: "Refused by Connect",
  off: "Off",
  refused: "Not running here",
  error: "Problem",
};

/** What the UI needs to know about Connect on this machine. */
export function connectView(s: ConnectStatus) {
  const linked = !!s.enrolled || !!s.hostname;
  const on =
    s.state === "up" ||
    s.state === "connecting" ||
    s.state === "denied" ||
    (s.state === "error" && !!s.enrolled);
  return {
    linked,
    on,
    canToggle: linked && s.state !== "refused",
    hostname: s.hostname,
  };
}
