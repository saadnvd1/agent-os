import * as Linking from "expo-linking";
import type { PhrasingContent } from "mdast";
import { type TextStyle } from "react-native";
import { Text } from "~/components/ui/Text";
import { font, type Palette } from "~/lib/theme";
import { htmlText } from "./html";

export function Inline({ nodes, t }: { nodes: PhrasingContent[]; t: Palette }) {
  return <>{nodes.map((n, i) => renderInline(n, i, t))}</>;
}

function renderInline(
  n: PhrasingContent,
  key: number,
  t: Palette
): React.ReactNode {
  const kids = (style: TextStyle, children: PhrasingContent[]) => (
    <Text key={key} style={style}>
      <Inline nodes={children} t={t} />
    </Text>
  );
  switch (n.type) {
    case "text":
      return n.value;
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
            backgroundColor: t.codeBg,
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
      return "\n";
    case "image":
      return `[${n.alt || "image"}]`;
    case "html":
      return htmlText(n.value);
    default:
      return "children" in n ? (
        <Inline key={key} nodes={n.children as PhrasingContent[]} t={t} />
      ) : null;
  }
}
