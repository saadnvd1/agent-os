import * as Clipboard from "expo-clipboard";
import { Fragment, memo, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Icon } from "~/components/ui/Icon";
import { Text } from "~/components/ui/Text";
import { haptic } from "~/lib/haptics";
import { font, HIT, radius, space, useTheme } from "~/lib/theme";
import { highlight, highlightStreaming } from "./highlight/highlight";
import { ONE_DARK, ONE_LIGHT, tokenColor } from "./highlight/theme";

interface Props {
  code: string;
  lang?: string | null;
  streaming?: boolean;
}

// A fenced block, as the web draws it: language, copy, highlighted code.
export const CodeBlock = memo(function CodeBlock({
  code,
  lang,
  streaming,
}: Props) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  const lines = useMemo(
    () => (streaming ? highlightStreaming(code, lang) : highlight(code, lang)),
    [code, lang, streaming]
  );
  const colors = t.scheme === "dark" ? ONE_DARK : ONE_LIGHT;
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <View style={[styles.wrap, { backgroundColor: t.codeWash }]}>
      <View style={styles.head}>
        <Text style={[styles.lang, { color: t.muted }]}>{lang || "text"}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? "Copied" : "Copy code"}
          onPress={copy}
          style={styles.copy}
        >
          <Icon
            name={copied ? "checkmark" : "doc.on.doc"}
            size={14}
            color={t.muted}
          />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable style={[styles.code, { color: colors.base }]}>
          {lines.map((line, i) => (
            <Fragment key={i}>
              {line.map((tok, j) => (
                <Text
                  key={j}
                  style={{
                    color: tokenColor(tok.types, colors),
                    ...(tok.types.includes("comment")
                      ? { fontFamily: font.mono, fontStyle: "italic" }
                      : null),
                  }}
                >
                  {tok.text}
                </Text>
              ))}
              {i < lines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </Text>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.xl, overflow: "hidden" },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: space.md,
    minHeight: 36,
  },
  lang: { fontFamily: font.mono, fontSize: 11 },
  copy: {
    width: HIT,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  code: {
    fontFamily: font.mono,
    fontSize: 12,
    lineHeight: 20,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
  },
});
