import { StyleSheet, Text, View } from "react-native";
import type { SymbolViewProps } from "expo-symbols";
import { Icon } from "~/components/ui/Icon";
import { font, space, useTheme } from "~/lib/theme";

// A quiet one-line event in the timeline: a turn's end, a compaction, a note.
export function Line({
  icon,
  text,
  tone = "muted",
}: {
  icon: SymbolViewProps["name"];
  text: string;
  tone?: "muted" | "warning" | "destructive";
}) {
  const t = useTheme();
  const color =
    tone === "muted" ? t.faint : tone === "warning" ? t.warning : t.destructive;
  return (
    <View style={styles.row}>
      <Icon name={icon} size={12} color={color} />
      <Text
        style={[styles.text, { color: tone === "muted" ? t.muted : color }]}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "flex-start",
    paddingVertical: 2,
  },
  text: { flex: 1, fontSize: font.size.sm, lineHeight: 18 },
});
