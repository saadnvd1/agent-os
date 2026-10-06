import { parse } from "url";

/** The path of an upgrade request, or null when its target can't be parsed. */
export function upgradePath(target: string | undefined): string | null {
  try {
    return parse(target || "").pathname;
  } catch {
    return null;
  }
}
