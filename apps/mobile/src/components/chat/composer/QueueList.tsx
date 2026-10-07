import { Pressable, StyleSheet, Text, View } from "react-native";
import type { QueuedMessage } from "@/lib/chat/events";
import { Icon } from "~/components/ui/Icon";
import { haptic } from "~/lib/haptics";
import { font, radius, space, useTheme } from "~/lib/theme";

// Messages waiting for the running turn: send one now, or drop it.
export function QueueList({
  queue,
  sendNow,
  remove,
}: {
  queue: QueuedMessage[];
  sendNow: (id: string) => void;
  remove: (id: string) => void;
}) {
  const t = useTheme();
  if (!queue.length) return null;
  return (
    <View style={[styles.wrap, { backgroundColor: t.secondary }]}>
      {queue.map((q) => (
        <View key={q.id} style={styles.row}>
          <Icon name="clock" size={12} color={t.muted} />
          <Text
            numberOfLines={1}
            style={[styles.text, { color: t.foreground }]}
          >
            {q.text || `${q.imageCount ?? 0} image(s)`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send now"
            onPress={() => {
              haptic.send();
              sendNow(q.id);
            }}
            style={styles.now}
          >
            <Text
              style={{
                color: t.primary,
                fontSize: font.size.xs,
                fontWeight: "700",
              }}
            >
              Send now
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove from queue"
            onPress={() => remove(q.id)}
            style={styles.x}
          >
            <Icon name="xmark" size={12} color={t.muted} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    marginBottom: space.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 44,
  },
  text: { flex: 1, fontSize: font.size.sm },
  now: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm },
  x: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
});
