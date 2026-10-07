import { StyleSheet, View } from "react-native";
import type { ChatItem } from "@/lib/chat/events";
import { Text } from "~/components/ui/Text";
import { font, space, useTheme } from "~/lib/theme";

type TurnEndItem = Extract<ChatItem, { kind: "turn_end" }>;

// "Done in 3s" between hairlines, as the web ends a turn.
export function TurnEnd({ item }: { item: TurnEndItem }) {
  const t = useTheme();
  const secs = item.durationMs ? Math.round(item.durationMs / 1000) : null;
  const label = item.interrupted
    ? "Stopped"
    : secs !== null
      ? `Done in ${secs}s`
      : "Done";
  return (
    <View style={styles.row} accessibilityLabel={label}>
      <View style={[styles.line, { backgroundColor: t.hairline }]} />
      <Text style={[styles.text, { color: t.faint }]}>{label}</Text>
      <View style={[styles.line, { backgroundColor: t.hairline }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  line: { flex: 1, height: StyleSheet.hairlineWidth * 2 },
  text: { fontFamily: font.mono, fontSize: 11 },
});
