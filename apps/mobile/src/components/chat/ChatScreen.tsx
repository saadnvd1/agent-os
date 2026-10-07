import { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { groupTimeline } from "@/lib/chat/group";
import { SkeletonRows } from "~/components/ui/Skeleton";
import { useChat } from "~/lib/chat/useChat";
import type { Machine } from "~/lib/machines/store";
import { font, space, useTheme } from "~/lib/theme";
import { Composer } from "./composer/Composer";
import { TimelineBlock } from "./TimelineBlock";

export function ChatScreen({
  machine,
  sessionId,
}: {
  machine: Machine;
  sessionId: string;
}) {
  const t = useTheme();
  const chat = useChat(machine, sessionId);
  const { view } = chat;
  // Inverted: the newest block sits at the bottom and the list starts there.
  const blocks = useMemo(
    () => groupTimeline(view.items).reverse(),
    [view.items]
  );
  const running = view.state === "running";

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.fill, { backgroundColor: t.background }]}
    >
      {!view.loaded ? (
        <View style={styles.fill}>
          <SkeletonRows count={5} />
        </View>
      ) : (
        <FlatList
          inverted
          data={blocks}
          keyExtractor={(b) => (b.type === "item" ? b.item.id : b.id)}
          renderItem={({ item }) => (
            <TimelineBlock block={item} respond={chat.respond} />
          )}
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            running || view.state === "waiting" ? (
              <View style={styles.working}>
                <ActivityIndicator size="small" color={t.primary} />
                <Text style={[styles.workingText, { color: t.muted }]}>
                  {view.state === "waiting" ? "Waiting for you" : "Working…"}
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
      )}
      {!chat.live && view.loaded ? (
        <Text
          style={[
            styles.banner,
            { color: t.warning, backgroundColor: t.warningSoft },
          ]}
        >
          Reconnecting…
        </Text>
      ) : null}
      <Composer
        view={view}
        live={chat.live}
        send={chat.send}
        interrupt={chat.interrupt}
        sendNow={chat.sendNow}
        deleteQueued={chat.deleteQueued}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: space.lg, gap: space.lg },
  working: { flexDirection: "row", alignItems: "center", gap: space.sm },
  workingText: { fontSize: font.size.sm },
  empty: {
    textAlign: "center",
    fontSize: font.size.md,
    transform: [{ scaleY: -1 }],
    paddingVertical: space.xxl,
  },
  banner: {
    textAlign: "center",
    fontSize: font.size.xs,
    fontWeight: "600",
    paddingVertical: space.xs,
  },
});
