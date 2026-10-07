import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatImage } from "@/lib/chat/events";
import { offeredSuggestion } from "@/lib/chat/suggestion";
import { Icon } from "~/components/ui/Icon";
import type { ChatView } from "~/lib/chat/reducer";
import { haptic } from "~/lib/haptics";
import { font, HIT, radius, space, useTheme } from "~/lib/theme";
import { QueueList } from "./QueueList";
import { useAttachments } from "./useAttachments";

interface Props {
  view: ChatView;
  live: boolean;
  send: (text: string, images?: ChatImage[]) => boolean;
  interrupt: () => void;
  sendNow: (id: string) => void;
  deleteQueued: (id: string) => void;
}

export function Composer({
  view,
  live,
  send,
  interrupt,
  sendNow,
  deleteQueued,
}: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // With the keyboard up there is no home indicator to clear.
  const keyboard = useKeyboardState((s) => s.isVisible);
  const [text, setText] = useState("");
  const [dismissed, setDismissed] = useState<string | null>(null);
  const files = useAttachments();
  const running = view.state === "running" || view.state === "waiting";
  const offered = offeredSuggestion({
    suggestion: view.suggestion,
    dismissed,
    text,
  });
  const canSend = live && (!!text.trim() || files.items.length > 0);

  const submit = () => {
    if (!canSend) return;
    const images = files.items.map(({ mediaType, data }) => ({
      mediaType,
      data,
    }));
    if (send(text.trim(), images)) {
      haptic.send();
      setText("");
      files.clear();
    }
  };

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: t.background,
          paddingBottom: keyboard
            ? space.sm
            : Math.max(insets.bottom, space.sm),
        },
      ]}
    >
      <QueueList queue={view.queue} sendNow={sendNow} remove={deleteQueued} />
      {offered ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Use suggestion: ${offered}`}
          onPress={() => {
            haptic.tap();
            setText(offered);
          }}
          onLongPress={() => setDismissed(offered)}
          style={[styles.chip, { backgroundColor: t.primarySoft }]}
        >
          <Icon name="arrow.turn.down.right" size={12} color={t.muted} />
          <Text
            numberOfLines={2}
            style={[styles.chipText, { color: t.foreground }]}
          >
            {offered}
          </Text>
        </Pressable>
      ) : null}
      {files.items.length ? (
        <View style={styles.thumbs}>
          {files.items.map((a) => (
            <Pressable
              key={a.uri}
              onPress={() => files.remove(a.uri)}
              accessibilityLabel="Remove image"
            >
              <Image source={{ uri: a.uri }} style={styles.thumb} />
              <View style={[styles.thumbX, { backgroundColor: t.foreground }]}>
                <Icon
                  name="xmark"
                  size={9}
                  color={t.background}
                  weight="bold"
                />
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={[styles.box, { backgroundColor: t.card }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach photos"
          onPress={files.pick}
          style={styles.side}
        >
          <Icon name="photo.on.rectangle" size={20} color={t.muted} />
        </Pressable>
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            if (view.suggestion) setDismissed(view.suggestion);
          }}
          placeholder={
            running
              ? "Queue a message"
              : live
                ? "Message the agent"
                : "Reconnecting…"
          }
          placeholderTextColor={t.faint}
          multiline
          accessibilityLabel="Message"
          style={[styles.input, { color: t.foreground }]}
        />
        {running && !text.trim() && !files.items.length ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop"
            onPress={() => {
              haptic.warn();
              interrupt();
            }}
            style={styles.side}
          >
            <View style={[styles.send, { backgroundColor: t.foreground }]}>
              <Icon name="stop.fill" size={12} color={t.background} />
            </View>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={running ? "Queue" : "Send"}
            onPress={submit}
            disabled={!canSend}
            style={styles.side}
          >
            <View
              style={[
                styles.send,
                { backgroundColor: canSend ? t.primary : t.secondary },
              ]}
            >
              <Icon
                name="arrow.up"
                size={15}
                color={canSend ? t.onPrimary : t.faint}
                weight="bold"
              />
            </View>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingTop: space.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    alignSelf: "flex-start",
    maxWidth: "100%",
    minHeight: HIT,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    marginBottom: space.sm,
  },
  chipText: { flexShrink: 1, fontSize: font.size.sm },
  thumbs: { flexDirection: "row", gap: space.sm, marginBottom: space.sm },
  thumb: { width: 56, height: 56, borderRadius: radius.sm },
  thumbX: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  box: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 22,
    minHeight: HIT,
  },
  side: {
    width: HIT,
    height: HIT,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    fontSize: font.size.md,
    maxHeight: 140,
    paddingTop: 12,
    paddingBottom: 12,
  },
  send: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
});
