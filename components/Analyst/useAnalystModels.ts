import { useAgentRolesQuery, useModelChoices } from "@/data/models";
import { analystBlock, defaultAnalystLabel } from "@/lib/models/usable";

// What an analyst's model pickers need, all from the server: the list, the
// reason a model can't be picked, and the label of the default (the model
// the analyst role resolves to in the project the analyst starts in).
export function useAnalystModels(projectId?: string | null) {
  const { data: choices = [] } = useModelChoices();
  const roles = useAgentRolesQuery(
    projectId ? "project" : "settings",
    projectId
  );
  const bound = roles.data?.roles.find((r) => r.id === "analyst")?.binding;
  return {
    choices,
    defaultLabel: defaultAnalystLabel(bound?.ref, choices),
    blockedBy: analystBlock,
  };
}
