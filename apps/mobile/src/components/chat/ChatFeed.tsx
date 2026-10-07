import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { ApprovalDecision, ChatItem, ChatState } from "@/lib/chat/events";
import { groupTimeline, type TimelineBlock as Block } from "@/lib/chat/group";
import { Icon } from "~/components/ui/Icon";
import { Text } from "~/components/ui/Text";
import { haptic } from "~/lib/haptics";
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
  insetTop = 0,
  insetBottom = 0,
}: {
  items: ChatItem[];
  state: ChatState;
  respond: (id: string, d: ApprovalDecision) => void;
  // Room for the see-through header and the floating composer.
  insetTop?: number;
  insetBottom?: number;
}) {
  const t = useTheme();
  const blocks = useMemo(() => groupTimeline(items), [items]);
  const busy = state === "running" || state === "waiting";
  const list = useRef<LegendListRef>(null);
  const [away, setAway] = useState(false);
  return (
    <View style={styles.fill}>
      <LegendList
        ref={list}
        onScroll={() => {
          const near = list.current?.getState().isNearEnd ?? true;
          if (near === away) setAway(!near);
        }}
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
        contentContainerStyle={[
          styles.list,
          {
            paddingTop: insetTop + space.lg,
            paddingBottom: insetBottom + space.sm,
          },
        ]}
        scrollIndicatorInsets={{ top: insetTop, bottom: insetBottom }}
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
      {away ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Jump to latest"
          hitSlop={8}
          onPress={() => {
            haptic.tap();
            void list.current?.scrollToEnd({ animated: true });
          }}
          style={[
            styles.jump,
            { bottom: insetBottom + space.md },
            { backgroundColor: t.card, borderColor: t.border },
          ]}
        >
          <Icon name="arrow.down" size={18} color={t.foreground} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  jump: {
    position: "absolute",
    right: space.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  list: { paddingHorizontal: space.lg },
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
