import type { RootContent, Table } from "mdast";
import { memo, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text } from "~/components/ui/Text";
import { font, radius, space, useTheme, type Palette } from "~/lib/theme";
import { chunk, imageUrls, type Chunk } from "./chunks";
import { CodeBlock } from "./CodeBlock";
import { MermaidBlock } from "../web/MermaidBlock";
import { ImageRow } from "./ImageRow";
import { Inline } from "./Inline";
import { parseMarkdown } from "./parse";
import { Prose } from "./Prose";

// A reply: prose as selectable native text, code, tables, quotes and
// images as their own views. Only the last chunk can still be streaming.
export const Markdown = memo(function Markdown({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  const t = useTheme();
  const { chunks, images } = useMemo(() => {
    const tree = parseMarkdown(text);
    return { chunks: chunk(tree.children), images: imageUrls(tree.children) };
  }, [text]);
  return (
    <View style={styles.root}>
      {chunks.map((c, i) => (
        <ChunkView
          key={c.key}
          chunk={c}
          t={t}
          images={images}
          streaming={streaming && i === chunks.length - 1}
        />
      ))}
    </View>
  );
});

function ChunkView({
  chunk: c,
  t,
  images,
  streaming,
}: {
  chunk: Chunk;
  t: Palette;
  images: string[];
  streaming?: boolean;
}) {
  if (c.kind === "prose") return <Prose nodes={c.nodes} t={t} />;
  if (c.kind === "images")
    return <ImageRow images={c.images.map((img) => img.url)} all={images} />;
  return <Block node={c.node} t={t} streaming={streaming} />;
}

function Block({
  node,
  t,
  streaming,
}: {
  node: RootContent;
  t: Palette;
  streaming?: boolean;
}) {
  switch (node.type) {
    case "code":
      return node.lang === "mermaid" ? (
        <MermaidBlock code={node.value} streaming={streaming} />
      ) : (
        <CodeBlock code={node.value} lang={node.lang} streaming={streaming} />
      );
    case "table":
      return <TableBlock table={node} t={t} />;
    case "blockquote":
      return (
        <View style={[styles.quote, { borderLeftColor: t.border }]}>
          {chunk(node.children).map((c) => (
            <ChunkView key={c.key} chunk={c} t={t} images={[]} />
          ))}
        </View>
      );
    default:
      return null;
  }
}

function TableBlock({ table, t }: { table: Table; t: Palette }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={[styles.table, { borderColor: t.border }]}>
        {table.children.map((row, r) => (
          <View
            key={r}
            style={[styles.tr, r === 0 && { backgroundColor: t.codeWash }]}
          >
            {row.children.map((cell, c) => (
              <Text
                key={c}
                selectable
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
  root: { gap: space.md },
  quote: { borderLeftWidth: 3, paddingLeft: space.md, gap: space.sm },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
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
