import { useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AskCard } from "~/components/asks/AskCard";
import { useMachineAsks } from "~/components/asks/useMachineAsks";
import { SessionRow } from "~/components/sessions/SessionRow";
import { useShelves } from "~/components/sessions/useShelves";
import { Empty } from "~/components/ui/Empty";
import { SkeletonRows } from "~/components/ui/Skeleton";
import { useWorkspaces } from "~/lib/sessions/queries";
import { font, radius, space, useTheme } from "~/lib/theme";

export default function NeedsScreen() {
  const t = useTheme();
  const { machine, asks, query } = useMachineAsks();
  const { shelves, projectNames, sessions } = useShelves("", 0);
  const workspaces = useWorkspaces(machine).data ?? [];
  const blocked = shelves.find((s) => s.key === "needsYou")?.data ?? [];
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([query.refetch(), sessions.refetch()]).catch(() => {});
    setRefreshing(false);
  };
  const loading = query.isPending || sessions.isPending;

  return (
    <ScrollView
      style={{ backgroundColor: t.background }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} />
      }
      contentContainerStyle={{ paddingBottom: space.xxl, gap: space.md }}
    >
      {loading ? <SkeletonRows count={4} /> : null}
      {!loading && !asks.length && !blocked.length ? (
        <Empty
          icon="checkmark.seal"
          title="Nothing needs you"
          body="Asks from the orchestrator and blocked sessions show up here."
        />
      ) : null}
      {asks.length && machine ? (
        <Text style={[styles.title, { color: t.muted }]}>ASKS</Text>
      ) : null}
      {machine
        ? asks.map(({ ask, workspaceId }) => (
            <AskCard
              key={`${workspaceId}:${ask.id}`}
              ask={ask}
              workspaceId={workspaceId}
              workspaceName={
                workspaces.find((w) => w.id === workspaceId)?.name ??
                "Workspace"
              }
              machine={machine}
            />
          ))
        : null}
      {blocked.length ? (
        <>
          <Text style={[styles.title, { color: t.muted }]}>SESSIONS</Text>
          <View style={[styles.group, { backgroundColor: t.card }]}>
            {blocked.map((row) => (
              <SessionRow
                key={row.session.id}
                row={row}
                project={projectNames.get(row.session.project_id ?? "") ?? ""}
              />
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: font.size.xs,
    fontWeight: "600",
    letterSpacing: 0.6,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  group: {
    marginHorizontal: space.lg,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
});
