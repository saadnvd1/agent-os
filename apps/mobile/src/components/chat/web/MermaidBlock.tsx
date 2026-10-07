import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "~/components/ui/Text";
import { font, radius, space, useTheme } from "~/lib/theme";
import { CodeBlock } from "../markdown/CodeBlock";
import { mermaidHtml } from "./sandbox";
import { SandboxWeb } from "./SandboxWeb";

// A mermaid diagram drawn in a sandboxed WebView; its source if it fails
// or while the reply is still streaming.
export function MermaidBlock({
  code,
  streaming,
}: {
  code: string;
  streaming?: boolean;
}) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  if (streaming || failed)
    return <CodeBlock code={code} lang="mermaid" streaming={streaming} />;
  return (
    <View style={[styles.wrap, { backgroundColor: t.codeWash }]}>
      <Text style={[styles.label, { color: t.muted }]}>mermaid</Text>
      <SandboxWeb
        key={t.scheme}
        source={{
          html: mermaidHtml(code, t.scheme === "dark"),
          baseUrl: "about:blank",
        }}
        home="about:blank"
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.xl, overflow: "hidden" },
  label: {
    fontFamily: font.mono,
    fontSize: 11,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
});
