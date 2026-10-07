import { Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SkeletonRows } from "~/components/ui/Skeleton";
import { Text } from "~/components/ui/Text";
import { ChatSession } from "~/lib/chat/draft";
import { useChat } from "~/lib/chat/useChat";
import type { Machine } from "~/lib/machines/store";
import { font, glass, space, useTheme } from "~/lib/theme";
import { ChatFeed } from "./ChatFeed";
import { Composer } from "./composer/Composer";

// The feed runs the full height of the screen, under a see-through header
// and a floating composer, so the conversation shows through the glass.
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
  const top = useHeaderHeight();
  const [bottom, setBottom] = useState(0);

  return (
    <ChatSession.Provider value={sessionId}>
      <Stack.Screen
        options={{
          headerTransparent: true,
          headerBlurEffect: glass ? undefined : "systemChromeMaterial",
          headerShadowVisible: false,
        }}
      />
      <KeyboardAvoidingView
        behavior="padding"
        style={[styles.fill, { backgroundColor: t.background }]}
      >
        {!view.loaded ? (
          <View style={[styles.fill, { paddingTop: top }]}>
            <SkeletonRows count={5} />
          </View>
        ) : (
          <ChatFeed
            items={view.items}
            state={view.state}
            respond={chat.respond}
            insetTop={top}
            insetBottom={bottom}
          />
        )}
        <View
          style={styles.dock}
          onLayout={(e) => setBottom(e.nativeEvent.layout.height)}
        >
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
            setModel={chat.setModel}
            setAccess={chat.setAccess}
            setPlan={chat.setPlan}
            findFiles={chat.findFiles}
          />
        </View>
      </KeyboardAvoidingView>
    </ChatSession.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dock: { position: "absolute", left: 0, right: 0, bottom: 0 },
  banner: {
    textAlign: "center",
    fontSize: font.size.xs,
    fontWeight: "600",
    paddingVertical: space.xs,
  },
});
