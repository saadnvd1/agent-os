import { Fragment, memo, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { FileDiff } from "@/lib/chat/events";
import { lineDiff, shortPath } from "@/lib/chat/diff";
import { Icon } from "~/components/ui/Icon";
import { Text } from "~/components/ui/Text";
import { haptic } from "~/lib/haptics";
import { font, HIT, radius, space, useTheme } from "~/lib/theme";
import { highlight } from "../markdown/highlight/highlight";
import { ONE_DARK, ONE_LIGHT, tokenColor } from "../markdown/highlight/theme";
import { diffRows, extOf, unfold, type DiffRow } from "./diffRows";

// One file's change: a header (path, +/−, collapse), a gutter with old and
// new line numbers, highlighted code, and unchanged runs folded away.
export const DiffView = memo(function DiffView({
  diff,
  startOpen = true,
}: {
  diff: FileDiff;
  startOpen?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(startOpen);
  const lines = useMemo(() => lineDiff(diff.before, diff.after), [diff]);
  const [rows, setRows] = useState<DiffRow[]>(() => diffRows(lines));
  const adds = lines.filter((l) => l.op === "+").length;
  const dels = lines.filter((l) => l.op === "-").length;
  const colors = t.scheme === "dark" ? ONE_DARK : ONE_LIGHT;
  const lang = extOf(diff.path);
  const width = String(
    Math.max(
      ...rows.map((r) =>
        r.kind === "line" ? Math.max(r.old ?? 0, r.new ?? 0) : 0
      ),
      1
    )
  ).length;

  const expand = (i: number) => {
    const fold = rows[i];
    if (fold.kind !== "fold") return;
    haptic.tap();
    setRows((cur) => [
      ...cur.slice(0, i),
      ...unfold(lines, fold.from, fold.count),
      ...cur.slice(i + 1),
    ]);
  };

  return (
    <View style={[styles.wrap, { backgroundColor: t.codeWash }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${shortPath(diff.path)}, ${adds} added, ${dels} removed`}
        onPress={() => setOpen((o) => !o)}
        style={styles.head}
      >
        <Icon
          name={open ? "chevron.down" : "chevron.right"}
          size={11}
          color={t.muted}
        />
        <Text numberOfLines={1} style={[styles.path, { color: t.foreground }]}>
          {shortPath(diff.path)}
        </Text>
        <Text style={[styles.count, { color: t.success }]}>+{adds}</Text>
        <Text style={[styles.count, { color: t.destructive }]}>−{dels}</Text>
      </Pressable>
      {open ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.grow}
        >
          <View style={styles.grow}>
            {rows.map((r, i) =>
              r.kind === "fold" ? (
                <Pressable
                  key={`f${r.from}`}
                  accessibilityRole="button"
                  onPress={() => expand(i)}
                  style={[styles.fold, { backgroundColor: t.wash }]}
                >
                  <Text style={[styles.foldText, { color: t.muted }]}>
                    ⋯ {r.count} unchanged line{r.count === 1 ? "" : "s"}
                  </Text>
                </Pressable>
              ) : (
                <View
                  key={`${r.old}:${r.new}:${i}`}
                  style={[
                    styles.row,
                    r.op === "+" && { backgroundColor: t.diffAdd },
                    r.op === "-" && { backgroundColor: t.diffDel },
                  ]}
                >
                  <Text
                    style={[
                      styles.gutter,
                      { color: t.faint, width: width * 7.5 + 8 },
                    ]}
                  >
                    {r.old ?? ""}
                  </Text>
                  <Text
                    style={[
                      styles.gutter,
                      { color: t.faint, width: width * 7.5 + 8 },
                    ]}
                  >
                    {r.new ?? ""}
                  </Text>
                  <Text
                    style={[
                      styles.sign,
                      {
                        color:
                          r.op === "+"
                            ? t.success
                            : r.op === "-"
                              ? t.destructive
                              : t.faint,
                      },
                    ]}
                  >
                    {r.op === " " ? "" : r.op === "-" ? "−" : "+"}
                  </Text>
                  <Text style={[styles.code, { color: colors.base }]}>
                    {(highlight(r.text, lang)[0] ?? []).map((tok, j) => (
                      <Fragment key={j}>
                        <Text style={{ color: tokenColor(tok.types, colors) }}>
                          {tok.text}
                        </Text>
                      </Fragment>
                    ))}
                  </Text>
                </View>
              )
            )}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: "hidden" },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    minHeight: HIT,
  },
  path: { flex: 1, fontFamily: font.mono, fontSize: font.size.xs },
  count: { fontFamily: font.mono, fontSize: font.size.xs, fontWeight: "600" },
  grow: { flexGrow: 1 },
  row: { flexDirection: "row", minHeight: 20 },
  gutter: {
    fontFamily: font.mono,
    fontSize: 11,
    lineHeight: 20,
    textAlign: "right",
    paddingRight: 6,
  },
  sign: {
    fontFamily: font.mono,
    fontSize: 12,
    lineHeight: 20,
    width: 14,
    textAlign: "center",
  },
  code: {
    fontFamily: font.mono,
    fontSize: 12,
    lineHeight: 20,
    paddingRight: space.md,
  },
  fold: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: space.md,
  },
  foldText: { fontFamily: font.mono, fontSize: 11 },
});
