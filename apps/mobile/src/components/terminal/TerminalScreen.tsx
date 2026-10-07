import * as Linking from "expo-linking";
import { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "~/components/ui/Button";
import { SkeletonRows } from "~/components/ui/Skeleton";
import type { Machine } from "~/lib/machines/store";
import { usePreview } from "~/lib/sessions/queries";
import { font, radius, space, useTheme } from "~/lib/theme";

// Phase 1: a read-only view of the pane, refreshed every two seconds. The
// native terminal (typing, scrollback, a hardware keyboard) is phase 2.
export function TerminalScreen({
  machine,
  sessionId,
}: {
  machine: Machine;
  sessionId: string;
}) {
  const t = useTheme();
  const preview = usePreview(machine, sessionId);
  const scroll = useRef<ScrollView>(null);
  const lines = preview.data ?? [];

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: false });
  }, [lines.length]);

  return (
    <View style={[styles.fill, { backgroundColor: t.background }]}>
      <View style={[styles.pane, { backgroundColor: t.termBg }]}>
        {preview.isPending ? (
          <SkeletonRows count={8} />
        ) : (
          <ScrollView ref={scroll} contentContainerStyle={styles.content}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text selectable style={[styles.text, { color: t.termFg }]}>
                {lines.length ? lines.join("\n") : "The pane is empty."}
              </Text>
            </ScrollView>
          </ScrollView>
        )}
      </View>
      <View style={styles.actions}>
        <Text style={[styles.note, { color: t.muted }]}>
          Read-only for now. A native terminal you can type in is coming next.
        </Text>
        <Button
          label="Open full terminal"
          icon="terminal"
          variant="secondary"
          disabled
          onPress={() => {}}
        />
        <Button
          label="Open on the web"
          icon="safari"
          variant="ghost"
          onPress={() => Linking.openURL(machine.url)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pane: {
    flex: 1,
    margin: space.md,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  content: { padding: space.md },
  text: {
    fontFamily: font.mono,
    fontSize: 11.5,
    lineHeight: 16,
  },
  actions: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl,
    gap: space.sm,
  },
  note: { fontSize: font.size.xs, textAlign: "center", marginBottom: space.xs },
});
