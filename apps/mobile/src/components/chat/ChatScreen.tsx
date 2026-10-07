import { StyleSheet, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SkeletonRows } from "~/components/ui/Skeleton";
import { Text } from "~/components/ui/Text";
import { ChatSession } from "~/lib/chat/draft";
import { useChat } from "~/lib/chat/useChat";
import type { Machine } from "~/lib/machines/store";
import { font, space, useTheme } from "~/lib/theme";
import { ChatFeed } from "./ChatFeed";
import { Composer } from "./composer/Composer";

export function ChatScreen({
  machine,
  sessionId,
}: {
  machine: Machine;
  sessionId: string;
}) {
  const t = useTheme();
  const chat = useChat(machine, sessionId);
  const { view } = chat;

  return (
    <ChatSession.Provider value={sessionId}>
      <KeyboardAvoidingView
        behavior="padding"
        style={[styles.fill, { backgroundColor: t.background }]}
      >
        {!view.loaded ? (
          <View style={styles.fill}>
            <SkeletonRows count={5} />
          </View>
        ) : (
          <ChatFeed
            items={view.items}
            state={view.state}
            respond={chat.respond}
          />
        )}
        {!chat.live && view.loaded ? (
          <Text
            style={[
              styles.banner,
              { color: t.warning, backgroundColor: t.warningSoft },
            ]}
          >
            Reconnecting…
          </Text>
        ) : null}
        <Composer
          sessionId={sessionId}
          view={view}
          live={chat.live}
          send={chat.send}
          interrupt={chat.interrupt}
          sendNow={chat.sendNow}
          deleteQueued={chat.deleteQueued}
        />
      </KeyboardAvoidingView>
    </ChatSession.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  banner: {
    textAlign: "center",
    fontSize: font.size.xs,
    fontWeight: "600",
    paddingVertical: space.xs,
  },
});
