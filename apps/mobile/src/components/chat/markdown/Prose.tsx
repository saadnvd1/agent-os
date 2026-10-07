import type { List, RootContent } from "mdast";
import { Fragment } from "react";
import { StyleSheet } from "react-native";
import { SelectableText as T } from "~/components/ui/Text";
import { font, type Palette } from "~/lib/theme";
import { htmlBlockText } from "./html";
import { Inline } from "./Inline";
import { InlineText } from "./InlineText";

export const HEADING = [26, 21, 18, 16, 15, 15];

// A run of paragraphs, headings and lists as ONE native text, so a
// selection can cross them. Blocks are separated by a short blank line.
export function Prose({ nodes, t }: { nodes: RootContent[]; t: Palette }) {
  return (
    <InlineText.Provider value={T}>
      <T style={[styles.body, { color: t.foreground }]}>
        {nodes.map((n, i) => (
          <Fragment key={i}>
            {i > 0 ? <T style={styles.gap}>{"\n\n"}</T> : null}
            {piece(n, t)}
          </Fragment>
        ))}
      </T>
    </InlineText.Provider>
  );
}

function piece(n: RootContent, t: Palette): React.ReactNode {
  switch (n.type) {
    case "paragraph":
      return <Inline nodes={n.children} t={t} />;
    case "heading": {
      const size = HEADING[n.depth - 1];
      return (
        <T
          style={{
            fontSize: size,
            lineHeight: Math.round(size * 1.3),
            fontWeight: "700",
          }}
        >
          <Inline nodes={n.children} t={t} />
        </T>
      );
    }
    case "list":
      return <ListText list={n} t={t} depth={0} />;
    case "html":
      return <T>{htmlBlockText(n.value) ?? ""}</T>;
    case "thematicBreak":
      return <T style={{ color: t.faint }}>{"———"}</T>;
    default:
      return null;
  }
}

function ListText({
  list,
  t,
  depth,
}: {
  list: List;
  t: Palette;
  depth: number;
}) {
  const start = list.start ?? 1;
  const indent = "    ".repeat(depth);
  return (
    <>
      {list.children.map((item, i) => {
        const marker =
          item.checked != null
            ? item.checked
              ? "☑"
              : "☐"
            : list.ordered
              ? `${start + i}.`
              : "•";
        return (
          <Fragment key={i}>
            {i > 0 ? <T>{"\n"}</T> : null}
            <T style={{ color: t.muted }}>{`${indent}${marker}  `}</T>
            {item.children.map((c, j) => (
              <Fragment key={j}>
                {c.type === "list" ? (
                  <>
                    <T>{"\n"}</T>
                    <ListText list={c} t={t} depth={depth + 1} />
                  </>
                ) : c.type === "paragraph" ? (
                  <>
                    {j > 0 ? <T>{`\n${indent}    `}</T> : null}
                    <Inline nodes={c.children} t={t} />
                  </>
                ) : null}
              </Fragment>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: font.size.md, lineHeight: 22 },
  gap: { fontSize: 6, lineHeight: 8 },
});
