import type { Draft } from "@/lib/drafts";
import type { CatalogAgent, MachineCatalog } from "@/lib/machines/types";

// What stands between an agent and its first prompt, if anything.
export function catalogBlocker(a: CatalogAgent): string | null {
  if (!a.installed) return "Not installed";
  if (a.auth === "needs-login") return a.hint ?? "Needs sign-in";
  return null;
}

/** The agent to use when the one chosen can't run on this machine. */
export function usableAgent(
  catalog: MachineCatalog,
  agentType: Draft["agentType"]
): CatalogAgent | null {
  const have = catalog.agents.find((a) => a.agent === agentType);
  if (have && !catalogBlocker(have)) return null;
  return catalog.agents.find((a) => !catalogBlocker(a)) ?? null;
}
