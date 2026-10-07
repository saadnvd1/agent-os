import { LegendList } from "@legendapp/list/react-native";
import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { ApprovalDecision, ChatItem, ChatState } from "@/lib/chat/events";
import { groupTimeline, type TimelineBlock as Block } from "@/lib/chat/group";
import { Text } from "~/components/ui/Text";
import { font, space, useTheme } from "~/lib/theme";
import { TimelineBlock } from "./TimelineBlock";

const keyOf = (b: Block) => (b.type === "item" ? b.item.id : b.id);

// The conversation as a virtualized feed in reading order. It opens at the
// end, follows new output while you're at the bottom, and holds your place
// when you've scrolled up to read.
export function ChatFeed({
  items,
  state,
  respond,
}: {
  items: ChatItem[];
  state: ChatState;
  respond: (id: string, d: ApprovalDecision) => void;
}) {
  const t = useTheme();
  const blocks = useMemo(() => groupTimeline(items), [items]);
  const busy = state === "running" || state === "waiting";
  return (
    <LegendList
      data={blocks}
      keyExtractor={keyOf}
      renderItem={({ item }) => (
        <View style={styles.item}>
          <TimelineBlock block={item} respond={respond} />
        </View>
      )}
      estimatedItemSize={120}
      initialScrollAtEnd
      maintainScrollAtEnd
      maintainScrollAtEndThreshold={0.1}
      maintainVisibleContentPosition
      alignItemsAtEnd
      recycleItems={false}
      contentContainerStyle={styles.list}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      ListFooterComponent={
        busy ? (
          <View style={styles.working}>
            <ActivityIndicator size="small" color={t.primary} />
            <Text style={[styles.workingText, { color: t.muted }]}>
              {state === "waiting" ? "Waiting for you" : "Working…"}
            </Text>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <Text style={[styles.empty, { color: t.muted }]}>
          No messages yet. Say hello.
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  item: { paddingBottom: space.lg },
  working: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingBottom: space.lg,
  },
  workingText: { fontSize: font.size.sm },
  empty: {
    textAlign: "center",
    fontSize: font.size.md,
    paddingVertical: space.xxl,
  },
});
