import * as Clipboard from "expo-clipboard";
import { toString } from "mdast-util-to-string";
import { useState } from "react";
import {
  ActionSheetIOS,
  Pressable,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { quoteMarkdown } from "@/lib/chat/quote";
import { Icon } from "~/components/ui/Icon";
import { appendToDraft, useChatSession } from "~/lib/chat/draft";
import { haptic } from "~/lib/haptics";
import { HIT, useTheme } from "~/lib/theme";
import { parseMarkdown } from "../markdown/parse";

export const plainText = (markdown: string) =>
  parseMarkdown(markdown)
    .children.map((n) => toString(n))
    .join("\n\n");

// Copy, Copy as Markdown, Quote and Share for one message.
export function useMessageActions(markdown: string) {
  const session = useChatSession();
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const actions = [
    { label: "Copy", run: () => copy(plainText(markdown)) },
    { label: "Copy as Markdown", run: () => copy(markdown) },
    {
      label: "Quote",
      run: () => {
        appendToDraft(session, quoteMarkdown(markdown));
        haptic.tap();
      },
    },
    {
      label: "Share",
      run: () => Share.share({ message: plainText(markdown) }),
    },
  ];
  const menu = () => {
    haptic.press();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...actions.map((a) => a.label), "Cancel"],
        cancelButtonIndex: actions.length,
      },
      (i) => actions[i]?.run()
    );
  };
  return { copied, copy: () => copy(plainText(markdown)), menu };
}

// The quiet row under a reply, like the web's copy button.
export function MessageActions({ markdown }: { markdown: string }) {
  const t = useTheme();
  const { copied, copy, menu } = useMessageActions(markdown);
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? "Copied" : "Copy reply"}
        onPress={copy}
        style={styles.btn}
      >
        <Icon
          name={copied ? "checkmark" : "doc.on.doc"}
          size={13}
          color={t.faint}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More actions"
        onPress={menu}
        style={styles.btn}
      >
        <Icon name="ellipsis" size={13} color={t.faint} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", marginLeft: -14, marginVertical: -8 },
  btn: {
    width: HIT,
    height: HIT,
    alignItems: "center",
    justifyContent: "center",
  },
});
