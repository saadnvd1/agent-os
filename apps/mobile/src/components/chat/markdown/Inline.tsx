import * as Linking from "expo-linking";
import type { PhrasingContent } from "mdast";
import { type TextStyle } from "react-native";
import { useInlineText } from "./InlineText";
import { font, type Palette } from "~/lib/theme";
import { htmlText } from "./html";
import { openImage } from "~/lib/viewer";

export function Inline({ nodes, t }: { nodes: PhrasingContent[]; t: Palette }) {
  const Text = useInlineText();
  return <>{nodes.map((n, i) => renderInline(n, i, t, Text))}</>;
}

type TextKind = ReturnType<typeof useInlineText>;

function renderInline(
  n: PhrasingContent,
  key: number,
  t: Palette,
  Text: TextKind
): React.ReactNode {
  const kids = (style: TextStyle, children: PhrasingContent[]) => (
    <Text key={key} style={style}>
      <Inline nodes={children} t={t} />
    </Text>
  );
  switch (n.type) {
    // Every string sits in its own Text: the selectable native view only
    // lays out strings that are Text children.
    case "text":
      return <Text key={key}>{n.value}</Text>;
    case "strong":
      return kids({ fontWeight: "700" }, n.children);
    case "emphasis":
      return kids({ fontStyle: "italic" }, n.children);
    case "delete":
      return kids({ textDecorationLine: "line-through" }, n.children);
    case "inlineCode":
      return (
        <Text
          key={key}
          style={{
            fontFamily: font.mono,
            fontSize: font.size.sm,
            backgroundColor: t.codeWash,
            color: t.foreground,
          }}
        >
          {`\u2009${n.value}\u2009`}
        </Text>
      );
    case "link":
      return (
        <Text
          key={key}
          style={{ color: t.primary }}
          onPress={() => Linking.openURL(n.url)}
        >
          <Inline nodes={n.children} t={t} />
        </Text>
      );
    case "break":
      return <Text key={key}>{"\n"}</Text>;
    case "image":
      return (
        <Text
          key={key}
          style={{ color: t.primary }}
          onPress={() => openImage(n.url)}
        >
          {`[${n.alt || "image"}]`}
        </Text>
      );
    case "html":
      return <Text key={key}>{htmlText(n.value)}</Text>;
    default:
      return "children" in n ? (
        <Inline key={key} nodes={n.children as PhrasingContent[]} t={t} />
      ) : null;
  }
}
