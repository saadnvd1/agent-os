import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "~/components/ui/Text";
import type { ChatItem } from "@/lib/chat/events";
import { font, radius, space, useTheme } from "~/lib/theme";
import { openImages } from "~/lib/viewer";
import { InlineImage } from "../markdown/ImageRow";
import { useMessageActions } from "./MessageActions";

type UserItem = Extract<ChatItem, { kind: "user" }>;

export function UserMessage({ item }: { item: UserItem }) {
  const t = useTheme();
  const text = item.peer?.body ?? item.text;
  const { menu } = useMessageActions(text);
  const images = (item.images ?? []).map(
    (img) => `data:${img.mediaType};base64,${img.data}`
  );
  return (
    <View style={styles.wrap}>
      {item.from || item.peer ? (
        <Text style={[styles.from, { color: t.muted }]}>
          From {item.from ?? item.peer?.sessionId}
        </Text>
      ) : null}
      {item.images?.length ? (
        <View style={styles.images}>
          {images.map((uri, i) => (
            <InlineImage
              key={i}
              uri={uri}
              size={120}
              onPress={() => openImages(images, i)}
            />
          ))}
        </View>
      ) : null}
      {text ? (
        <Pressable
          onLongPress={menu}
          delayLongPress={350}
          accessibilityHint="Touch and hold for Copy, Quote and Share"
          style={[styles.bubble, { backgroundColor: t.bubble }]}
        >
          <Text style={[styles.text, { color: t.foreground }]}>{text}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "flex-end", gap: space.xs, paddingLeft: 48 },
  from: { fontSize: font.size.xs },
  bubble: {
    borderRadius: radius.xl,
    borderBottomRightRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  text: { fontSize: font.size.md, lineHeight: 22 },
  images: {
    flexDirection: "row",
    gap: space.xs,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
});
