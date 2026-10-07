import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "~/components/ui/Icon";
import type { Machine } from "~/lib/machines/store";
import { machineLabel } from "~/lib/machines/url";
import type { Filters } from "~/lib/sessions/filters";
import { useProjects, useWorkspaces } from "~/lib/sessions/queries";
import { haptic } from "~/lib/haptics";
import { font, radius, space, useTheme } from "~/lib/theme";

// Which machine, workspace and project the list shows; tap to change.
export function FilterBar({
  machine,
  filters,
  live,
}: {
  machine: Machine;
  filters: Filters;
  live: boolean;
}) {
  const t = useTheme();
  const workspaces = useWorkspaces(machine);
  const projects = useProjects(machine);
  const ws = workspaces.data?.find((w) => w.id === filters.workspaceId)?.name;
  const project = projects.data?.find((p) => p.id === filters.projectId)?.name;
  const parts = [
    machine.name || machineLabel(machine.url),
    ws ?? "All workspaces",
    project,
  ]
    .filter(Boolean)
    .join("  ›  ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Showing ${parts}. Change filter`}
      onPress={() => {
        haptic.tap();
        router.push("/filters");
      }}
      style={({ pressed }) => [
        styles.bar,
        { backgroundColor: pressed ? t.secondary : t.card },
      ]}
    >
      <View
        style={[styles.live, { backgroundColor: live ? t.success : t.faint }]}
      />
      <Text numberOfLines={1} style={[styles.text, { color: t.foreground }]}>
        {parts}
      </Text>
      <Icon
        name="line.3.horizontal.decrease.circle"
        size={18}
        color={t.primary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    marginBottom: space.xs,
    paddingHorizontal: space.md,
    minHeight: 44,
    borderRadius: radius.md,
  },
  live: { width: 7, height: 7, borderRadius: 4 },
  text: { flex: 1, fontSize: font.size.sm, fontWeight: "500" },
});
