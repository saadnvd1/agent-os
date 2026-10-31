import { readConnect } from "@/lib/connect/config";
import { listBookmarks } from "@/lib/bookmarks/store";
import { listRecipes } from "@/lib/recipes/store";
import { listSchedules } from "@/lib/schedules/store";
import { listDevices } from "@/lib/security/devices";
import { listGroups } from "@/lib/session-groups/store";
import { listSharedLinks } from "@/lib/share/store";
import type { Condition, Tip } from "./schema";

const CHECKS: Record<Condition, () => boolean> = {
  "no-paired-device": () => listDevices().length === 0,
  "no-push-device": () => !listDevices().some((d) => d.push.enabled),
  "connect-not-linked": () => !readConnect().ok,
  "connect-linked": () => {
    const c = readConnect();
    return c.ok && c.enabled;
  },
  "no-schedules": () => listSchedules().length === 0,
  "no-recipes": () => listRecipes().length === 0,
  "no-shares": () => listSharedLinks().length === 0,
  "no-groups": () => listGroups().length === 0,
  "no-bookmarks": () =>
    listBookmarks({ workspace: "all", limit: 1 }).bookmarks.length === 0,
};

/** Whether the tip applies now; a check that throws counts as no. */
export function tipApplies(
  tip: Pick<Tip, "when">,
  checks: Record<string, () => boolean> = CHECKS
): boolean {
  return (tip.when ?? []).every((c) => {
    try {
      return checks[c]?.() ?? false;
    } catch {
      return false;
    }
  });
}
