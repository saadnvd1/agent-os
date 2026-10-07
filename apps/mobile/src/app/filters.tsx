import { router } from "expo-router";
import { ScrollView } from "react-native";
import { GroupTitle, OptionRow } from "~/components/ui/OptionRow";
import { Group } from "~/components/ui/Group";
import { setFilters, useFilters } from "~/lib/sessions/filters";
import { useActiveMachine } from "~/lib/machines/store";
import { useProjects, useWorkspaces } from "~/lib/sessions/queries";
import { space, useTheme } from "~/lib/theme";

export default function FiltersSheet() {
  const t = useTheme();
  const machine = useActiveMachine();
  const filters = useFilters(machine?.id);
  const workspaces = useWorkspaces(machine).data ?? [];
  const projects = (useProjects(machine).data ?? []).filter(
    (p) => !filters.workspaceId || p.workspace_id === filters.workspaceId
  );
  if (!machine) return null;
  const pick = (next: Parameters<typeof setFilters>[1], close = false) => {
    setFilters(machine.id, next);
    if (close) router.back();
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.background }}
      contentContainerStyle={{ paddingBottom: space.xxl }}
    >
      <GroupTitle>Workspace</GroupTitle>
      <Group>
        <OptionRow
          label="All workspaces"
          selected={!filters.workspaceId}
          onPress={() => pick({ workspaceId: null, projectId: null })}
        />
        {workspaces.map((w) => (
          <OptionRow
            key={w.id}
            label={w.name}
            selected={filters.workspaceId === w.id}
            onPress={() => pick({ workspaceId: w.id, projectId: null })}
          />
        ))}
      </Group>
      <GroupTitle>Project</GroupTitle>
      <Group>
        <OptionRow
          label="All projects"
          selected={!filters.projectId}
          onPress={() => pick({ projectId: null }, true)}
        />
        {projects
          .filter((p) => !p.is_uncategorized)
          .map((p) => (
            <OptionRow
              key={p.id}
              label={p.name}
              selected={filters.projectId === p.id}
              onPress={() => pick({ projectId: p.id }, true)}
            />
          ))}
      </Group>
    </ScrollView>
  );
}
