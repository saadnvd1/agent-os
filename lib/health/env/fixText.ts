import { getSetting, putSetting } from "@/lib/settings-store";
import { classById } from "./classes";

export const MAX_FIX = 500;
const key = (id: string) => `health.envFix.${id}`;

// The fix a session is sent: this machine's own text if one was set (it
// stays in the local database, never in the repository), else the default.
export function fixFor(id: string): string | null {
  const own = getSetting(key(id));
  if (own !== null && own.trim() !== "") return own;
  return classById(id)?.fix ?? null;
}

export const hasOwnFix = (id: string): boolean =>
  (getSetting(key(id)) ?? "").trim() !== "";

// Null puts the default back. False for a class that doesn't exist.
export function setFix(id: string, text: string | null): boolean {
  if (!classById(id)) return false;
  const t = text?.replace(/\s+/g, " ").trim().slice(0, MAX_FIX) ?? "";
  putSetting(key(id), t === "" ? null : t);
  return true;
}
