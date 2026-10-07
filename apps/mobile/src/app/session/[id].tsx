import { Stack, useLocalSearchParams } from "expo-router";
import { ChatScreen } from "~/components/chat/ChatScreen";
import { TerminalScreen } from "~/components/terminal/TerminalScreen";
import { Empty } from "~/components/ui/Empty";
import { SkeletonRows } from "~/components/ui/Skeleton";
import { useActiveMachine } from "~/lib/machines/store";
import { useSessions } from "~/lib/sessions/queries";

export default function SessionScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const machine = useActiveMachine();
  const sessions = useSessions(machine);
  const session = sessions.data?.find((s) => s.id === id);

  return (
    <>
      <Stack.Screen options={{ title: session?.name ?? name ?? "" }} />
      {!machine ? null : sessions.isPending ? (
        <SkeletonRows count={5} />
      ) : session?.view === "terminal" ? (
        <TerminalScreen machine={machine} sessionId={id} />
      ) : session ? (
        <ChatScreen machine={machine} sessionId={id} />
      ) : (
        <Empty
          icon="questionmark.folder"
          title="Session not found"
          body="It may have been archived."
        />
      )}
    </>
  );
}
