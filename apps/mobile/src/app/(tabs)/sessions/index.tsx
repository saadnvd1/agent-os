import { Stack } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "~/components/ui/Text";
import { DONE_PAGE } from "@/lib/sidebar/shelves";
import { FilterBar } from "~/components/sessions/FilterBar";
import { SessionRow } from "~/components/sessions/SessionRow";
import { useShelves } from "~/components/sessions/useShelves";
import { Button } from "~/components/ui/Button";
import { Empty } from "~/components/ui/Empty";
import { SkeletonRows } from "~/components/ui/Skeleton";
import { markOnce } from "~/lib/perf";
import { font, space, useTheme } from "~/lib/theme";

const FIRST_DONE = 10;

export default function SessionsScreen() {
  const t = useTheme();
  const [query, setQuery] = useState("");
  const [doneLimit, setDoneLimit] = useState(FIRST_DONE);
  const { machine, sessions, shelves, projectNames, live, filters } =
    useShelves(query, doneLimit);
  const [refreshing, setRefreshing] = useState(false);
  if (sessions.data) markOnce("sessions-ready", sessions.data.length);

  const refresh = async () => {
    setRefreshing(true);
    await sessions.refetch().catch(() => {});
    setRefreshing(false);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: "Search sessions",
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            onCancelButtonPress: () => setQuery(""),
            hideWhenScrolling: true,
          },
        }}
      />
      <SectionList
        style={{ backgroundColor: t.background }}
        contentInsetAdjustmentBehavior="automatic"
        sections={shelves}
        keyExtractor={(row) => row.session.id}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        ListHeaderComponent={
          machine ? (
            <FilterBar machine={machine} filters={filters} live={live} />
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.shelf, { color: t.muted }]}>
            {section.title.toUpperCase()} · {section.total}
          </Text>
        )}
        renderItem={({ item }) => (
          <View>
            <SessionRow
              row={item}
              project={projectNames.get(item.session.project_id ?? "") ?? ""}
            />
            {item.workers.map((w) => (
              <SessionRow
                key={w.session.id}
                row={w}
                nested
                project={projectNames.get(w.session.project_id ?? "") ?? ""}
              />
            ))}
          </View>
        )}
        renderSectionFooter={({ section }) =>
          section.key === "done" && section.total > section.data.length ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setDoneLimit((n) => n + DONE_PAGE)}
              style={styles.more}
            >
              <Text
                style={{
                  color: t.primary,
                  fontSize: font.size.sm,
                  fontWeight: "600",
                }}
              >
                Show more
              </Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          sessions.isPending ? (
            <SkeletonRows />
          ) : sessions.isError ? (
            <Empty
              icon="wifi.exclamationmark"
              title="Can't reach this machine"
              body={sessions.error.message}
            >
              <Button label="Try again" variant="secondary" onPress={refresh} />
            </Empty>
          ) : (
            <Empty
              icon="tray"
              title={query ? "No matches" : "No sessions here"}
              body={
                query
                  ? undefined
                  : "Start a session on the web and it shows up here."
              }
            />
          )
        }
        contentContainerStyle={{ paddingBottom: space.xxl }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  shelf: {
    fontSize: font.size.xs,
    fontWeight: "600",
    letterSpacing: 0.6,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.xs,
  },
  more: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space.lg,
  },
});
