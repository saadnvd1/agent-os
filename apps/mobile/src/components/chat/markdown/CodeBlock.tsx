import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "~/components/ui/Text";
import { Icon } from "~/components/ui/Icon";
import { haptic } from "~/lib/haptics";
import { font, radius, space, useTheme } from "~/lib/theme";

export function CodeBlock({
  code,
  lang,
}: {
  code: string;
  lang?: string | null;
}) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <View style={[styles.wrap, { backgroundColor: t.codeBg }]}>
      <View style={styles.head}>
        <Text style={[styles.lang, { color: t.muted }]}>{lang || "code"}</Text>
        <Pressable
          accessibilityLabel="Copy code"
          onPress={copy}
          hitSlop={12}
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
        <Text selectable style={[styles.code, { color: t.foreground }]}>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.md, overflow: "hidden" },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: space.md,
    paddingRight: space.xs,
    minHeight: 32,
  },
  lang: { fontSize: font.size.xs, fontWeight: "500" },
  copy: {
    width: 36,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  code: {
    fontFamily: font.mono,
    fontSize: 12.5,
    lineHeight: 18,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
  },
});
