import { groupByName, listGroups } from "./store";
import { GroupError, type SessionGroup } from "./types";

// A group named by a caller (`aos --group`, an orchestrator tool): it must
// exist in that workspace, and the error lists the ones that do.
export function resolveGroup(
  workspaceId: string | null,
  name: string
): SessionGroup {
  const found = groupByName(workspaceId, name);
  if (found) return found;
  const names = listGroups(workspaceId).map((g) => `"${g.name}"`);
  throw new GroupError(
    "not-found",
    names.length
      ? `No group "${name.trim()}" in this workspace. Groups: ${names.join(", ")}`
      : `No group "${name.trim()}": this workspace has no groups`
  );
}
