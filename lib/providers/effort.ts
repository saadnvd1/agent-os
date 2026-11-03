import { getProviderDefinition, isValidProviderId } from "./registry";

// Why `effort` can't start this agent, or null when it can (or none is set).
export function effortRefusal(agent: string, effort: unknown): string | null {
  if (effort === undefined) return null;
  if (typeof effort !== "string" || !effort.trim())
    return "--effort needs a level";
  const levels = isValidProviderId(agent)
    ? getProviderDefinition(agent).effortLevels
    : undefined;
  if (!levels) return `${agent} has no effort levels`;
  return levels.includes(effort)
    ? null
    : `${agent} effort is one of: ${levels.join(", ")}`;
}
