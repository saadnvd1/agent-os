import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { FileDiff } from "@/lib/chat/events";
import { lineDiff, shortPath } from "@/lib/chat/diff";
import { font, radius, space, useTheme } from "~/lib/theme";

const FOLDED = 40;

// A unified diff of one file, the web's lineDiff drawn natively.
export function DiffView({ diff }: { diff: FileDiff }) {
  const t = useTheme();
  const [all, setAll] = useState(false);
  const lines = useMemo(() => lineDiff(diff.before, diff.after), [diff]);
  const adds = lines.filter((l) => l.op === "+").length;
  const dels = lines.filter((l) => l.op === "-").length;
  const shown = all ? lines : lines.slice(0, FOLDED);
  return (
    <View style={[styles.wrap, { backgroundColor: t.codeBg }]}>
      <View style={styles.head}>
        <Text numberOfLines={1} style={[styles.path, { color: t.foreground }]}>
          {shortPath(diff.path)}
        </Text>
        <Text style={[styles.count, { color: t.success }]}>+{adds}</Text>
        <Text style={[styles.count, { color: t.destructive }]}>−{dels}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.lines}
      >
        <View style={styles.lines}>
          {shown.map((l, i) => (
            <Text
              key={i}
              style={[
                styles.line,
                { color: l.op === " " ? t.muted : t.foreground },
                l.op === "+" && { backgroundColor: t.diffAdd },
                l.op === "-" && { backgroundColor: t.diffDel },
              ]}
            >
              {`${l.op} ${l.text}`}
            </Text>
          ))}
        </View>
      </ScrollView>
      {lines.length > FOLDED && !all ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAll(true)}
          style={styles.more}
        >
          <Text
            style={{
              color: t.primary,
              fontSize: font.size.xs,
              fontWeight: "600",
            }}
          >
            Show all {lines.length} lines
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    overflow: "hidden",
    paddingBottom: space.xs,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
  },
  path: { flex: 1, fontFamily: font.mono, fontSize: font.size.xs },
  count: { fontFamily: font.mono, fontSize: font.size.xs, fontWeight: "600" },
  line: {
    fontFamily: font.mono,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: space.md,
    minWidth: "100%",
  },
  lines: { flexGrow: 1 },
  more: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space.md,
  },
});
