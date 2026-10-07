import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import type { ChatItem } from "@/lib/chat/events";
import { font, radius, space, useTheme } from "~/lib/theme";

type UserItem = Extract<ChatItem, { kind: "user" }>;

export function UserMessage({ item }: { item: UserItem }) {
  const t = useTheme();
  const text = item.peer?.body ?? item.text;
  return (
    <View style={styles.wrap}>
      {item.from || item.peer ? (
        <Text style={[styles.from, { color: t.muted }]}>
          From {item.from ?? item.peer?.sessionId}
        </Text>
      ) : null}
      {item.images?.length ? (
        <View style={styles.images}>
          {item.images.map((img, i) => (
            <Image
              key={i}
              source={{ uri: `data:${img.mediaType};base64,${img.data}` }}
              style={styles.image}
              contentFit="cover"
            />
          ))}
        </View>
      ) : null}
      {text ? (
        <View style={[styles.bubble, { backgroundColor: t.primarySoft }]}>
          <Text selectable style={[styles.text, { color: t.foreground }]}>
            {text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "flex-end", gap: space.xs, paddingLeft: 48 },
  from: { fontSize: font.size.xs },
  bubble: {
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
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
  image: { width: 120, height: 120, borderRadius: radius.md },
});
