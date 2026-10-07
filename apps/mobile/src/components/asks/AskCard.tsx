import * as Linking from "expo-linking";
import { useState } from "react";
import { ActionSheetIOS, StyleSheet, View } from "react-native";
import { Text, TextInput } from "~/components/ui/Text";
import type { AskView } from "@/lib/orchestrator/ask-view";
import { Button } from "~/components/ui/Button";
import { useAnswerAsk } from "~/lib/asks/queries";
import { haptic } from "~/lib/haptics";
import type { Machine } from "~/lib/machines/store";
import { font, radius, space, useTheme } from "~/lib/theme";

interface Props {
  ask: AskView;
  workspaceId: string;
  workspaceName: string;
  machine: Machine;
}

// One orchestrator ask. Reply and Decline go straight through; Approve needs
// a passkey on the web until the phone has its own device key.
export function AskCard({ ask, workspaceId, workspaceName, machine }: Props) {
  const t = useTheme();
  const answer = useAnswerAsk(machine);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  // The detail often opens with the why; show it only when it adds more.
  const detail =
    ask.detail && !ask.detail.startsWith(ask.why.trim()) ? ask.detail : "";
  const declineNeedsPasskey = ask.subject.startsWith("passkey:");

  const submit = (body: Parameters<typeof answer.mutate>[0]["answer"]) =>
    answer.mutate(
      { workspaceId, askId: ask.id, answer: body },
      { onSuccess: () => haptic.success(), onError: () => haptic.warn() }
    );

  const decline = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: ask.title,
        options: ["Decline", "Cancel"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (i) => i === 0 && submit({ action: "decline" })
    );

  return (
    <View style={[styles.card, { backgroundColor: t.card }]}>
      <View style={styles.head}>
        <Text
          style={[
            styles.kind,
            { color: t.warning, backgroundColor: t.warningSoft },
          ]}
        >
          {ask.kind}
        </Text>
        <Text numberOfLines={1} style={[styles.ws, { color: t.muted }]}>
          {workspaceName}
        </Text>
      </View>
      <Text style={[styles.title, { color: t.foreground }]}>{ask.title}</Text>
      {ask.why ? (
        <Text style={[styles.why, { color: t.muted }]}>{ask.why}</Text>
      ) : null}
      {detail ? (
        <Text
          onPress={() => setExpanded((e) => !e)}
          numberOfLines={expanded ? undefined : 4}
          style={[
            styles.detail,
            { color: t.foreground, backgroundColor: t.codeBg },
          ]}
        >
          {detail}
        </Text>
      ) : null}
      {ask.sha ? (
        <Text style={[styles.meta, { color: t.muted }]}>
          Commit {ask.sha.slice(0, 10)}
        </Text>
      ) : null}
      {ask.link ? (
        <Text
          style={[styles.link, { color: t.primary }]}
          onPress={() => Linking.openURL(ask.link!)}
        >
          {ask.link.replace(/^https?:\/\//, "")}
        </Text>
      ) : null}

      {replying ? (
        <View style={{ gap: space.sm }}>
          <TextInput
            autoFocus
            multiline
            value={text}
            onChangeText={setText}
            placeholder="Your answer"
            accessibilityLabel="Your answer"
            placeholderTextColor={t.faint}
            style={[
              styles.input,
              { color: t.foreground, backgroundColor: t.secondary },
            ]}
          />
          <View style={styles.actions}>
            <Button
              label="Cancel"
              variant="ghost"
              compact
              onPress={() => setReplying(false)}
            />
            <Button
              label="Send reply"
              compact
              busy={answer.isPending}
              disabled={!text.trim()}
              onPress={() => submit({ action: "reply", text: text.trim() })}
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            label="Reply"
            icon="arrowshape.turn.up.left"
            variant="secondary"
            compact
            onPress={() => setReplying(true)}
          />
          {!declineNeedsPasskey ? (
            <Button
              label="Decline"
              variant="destructive"
              compact
              busy={answer.isPending}
              onPress={decline}
            />
          ) : null}
          <Button
            label="Approve on the web"
            icon="person.badge.key"
            variant="ghost"
            compact
            onPress={() => Linking.openURL(machine.url)}
          />
        </View>
      )}
      {answer.isError ? (
        <Text style={[styles.meta, { color: t.destructive }]}>
          {answer.error.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.lg,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  kind: {
    fontSize: font.size.xs,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  ws: { flex: 1, fontSize: font.size.xs },
  title: { fontSize: font.size.lg, fontWeight: "600", lineHeight: 23 },
  why: { fontSize: font.size.sm, lineHeight: 19 },
  detail: {
    fontSize: font.size.sm,
    lineHeight: 19,
    padding: space.md,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  meta: { fontSize: font.size.xs },
  link: { fontSize: font.size.sm },
  input: {
    minHeight: 80,
    borderRadius: radius.md,
    padding: space.md,
    fontSize: font.size.md,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    marginTop: space.xs,
  },
});
