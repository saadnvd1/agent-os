import type { List, RootContent, Table } from "mdast";
import { memo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { font, space, useTheme, type Palette } from "~/lib/theme";
import { CodeBlock } from "./CodeBlock";
import { Inline } from "./Inline";
import { parseMarkdown } from "./parse";

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const t = useTheme();
  const tree = parseMarkdown(text);
  return (
    <View style={styles.root}>
      {tree.children.map((n, i) => block(n, i, t))}
    </View>
  );
});

const HEADING = [22, 19, 17, 16, 15, 15];

function block(n: RootContent, key: number, t: Palette): React.ReactNode {
  const body = [styles.p, { color: t.foreground }];
  switch (n.type) {
    case "paragraph":
      return (
        <Text key={key} selectable style={body}>
          <Inline nodes={n.children} t={t} />
        </Text>
      );
    case "heading":
      return (
        <Text
          key={key}
          style={[
            body,
            {
              fontSize: HEADING[n.depth - 1],
              fontWeight: "700",
              marginTop: space.xs,
            },
          ]}
        >
          <Inline nodes={n.children} t={t} />
        </Text>
      );
    case "code":
      return <CodeBlock key={key} code={n.value} lang={n.lang} />;
    case "blockquote":
      return (
        <View key={key} style={[styles.quote, { borderLeftColor: t.border }]}>
          {n.children.map((c, i) => block(c, i, t))}
        </View>
      );
    case "list":
      return <ListBlock key={key} list={n} t={t} />;
    case "thematicBreak":
      return (
        <View key={key} style={[styles.rule, { backgroundColor: t.border }]} />
      );
    case "table":
      return <TableBlock key={key} table={n} t={t} />;
    case "html":
      return (
        <Text key={key} style={[body, { color: t.muted }]}>
          {n.value}
        </Text>
      );
    default:
      return null;
  }
}

function ListBlock({ list, t }: { list: List; t: Palette }) {
  const start = list.start ?? 1;
  return (
    <View style={styles.list}>
      {list.children.map((item, i) => (
        <View key={i} style={styles.item}>
          <Text style={[styles.p, styles.marker, { color: t.muted }]}>
            {item.checked != null
              ? item.checked
                ? "☑"
                : "☐"
              : list.ordered
                ? `${start + i}.`
                : "•"}
          </Text>
          <View style={styles.itemBody}>
            {item.children.map((c, n) => block(c, n, t))}
          </View>
        </View>
      ))}
    </View>
  );
}

function TableBlock({ table, t }: { table: Table; t: Palette }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={[styles.table, { borderColor: t.border }]}>
        {table.children.map((row, r) => (
          <View
            key={r}
            style={[styles.tr, r === 0 && { backgroundColor: t.codeBg }]}
          >
            {row.children.map((cell, c) => (
              <Text
                key={c}
                style={[
                  styles.td,
                  {
                    color: t.foreground,
                    borderColor: t.border,
                    fontWeight: r === 0 ? "600" : "400",
                  },
                ]}
              >
                <Inline nodes={cell.children} t={t} />
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  p: { fontSize: font.size.md, lineHeight: 22 },
  quote: { borderLeftWidth: 3, paddingLeft: space.md, gap: space.sm },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: space.sm },
  list: { gap: space.xs },
  item: { flexDirection: "row", gap: space.sm },
  marker: { minWidth: 16, textAlign: "right" },
  itemBody: { flex: 1, gap: space.xs },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    overflow: "hidden",
  },
  tr: { flexDirection: "row" },
  td: {
    minWidth: 90,
    maxWidth: 240,
    padding: space.sm,
    fontSize: font.size.sm,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
