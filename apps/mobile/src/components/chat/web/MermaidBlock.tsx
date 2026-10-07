import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "~/components/ui/Text";
import { useActiveMachine } from "~/lib/machines/store";
import { font, radius, space, useTheme } from "~/lib/theme";
import { mermaidScript } from "~/lib/vendor";
import { CodeBlock } from "../markdown/CodeBlock";
import { mermaidHtml } from "./sandbox";
import { SandboxWeb } from "./SandboxWeb";

// A mermaid diagram drawn in a sandboxed WebView with mermaid from the
// machine; its source while streaming, loading, or if it can't be drawn.
export function MermaidBlock({
  code,
  streaming,
}: {
  code: string;
  streaming?: boolean;
}) {
  const t = useTheme();
  const machine = useActiveMachine();
  const [script, setScript] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!machine || streaming) return;
    let live = true;
    mermaidScript(machine)
      .then((js) => live && setScript(js))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [machine, streaming]);

  if (streaming || failed || !script)
    return <CodeBlock code={code} lang="mermaid" streaming={streaming} />;
  return (
    <View style={[styles.wrap, { backgroundColor: t.codeWash }]}>
      <Text style={[styles.label, { color: t.muted }]}>mermaid</Text>
      <SandboxWeb
        key={t.scheme}
        prelude={script}
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
