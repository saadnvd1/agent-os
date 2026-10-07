import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "~/components/ui/Text";
import type { ApprovalDecision, ChatItem } from "@/lib/chat/events";
import { Button } from "~/components/ui/Button";
import { Icon } from "~/components/ui/Icon";
import { font, radius, space, useTheme } from "~/lib/theme";
import { DiffView } from "./DiffView";

type ApprovalItem = Extract<ChatItem, { kind: "approval" }>;

// The agent asking for access, or asking questions, mid-turn.
export function Approval({
  item,
  respond,
}: {
  item: ApprovalItem;
  respond: (id: string, d: ApprovalDecision) => void;
}) {
  const t = useTheme();
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const pending = item.status === "pending";
  const questions = item.questions ?? [];
  const toggle = (q: string, label: string, multi: boolean) =>
    setPicked((p) => {
      const cur = p[q] ?? [];
      const next = multi
        ? cur.includes(label)
          ? cur.filter((l) => l !== label)
          : [...cur, label]
        : [label];
      return { ...p, [q]: next };
    });
  const complete = questions.every((q) => picked[q.question]?.length);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.card,
          borderColor: pending ? t.warning : t.border,
        },
      ]}
    >
      <View style={styles.head}>
        <Icon
          name={questions.length ? "questionmark.bubble" : "hand.raised"}
          size={15}
          color={t.warning}
        />
        <Text style={[styles.title, { color: t.foreground }]}>
          {questions.length ? "The agent has a question" : item.title}
        </Text>
      </View>
      {item.diff ? <DiffView diff={item.diff} /> : null}
      {questions.map((q) => (
        <View key={q.question} style={{ gap: space.sm }}>
          <Text style={[styles.q, { color: t.foreground }]}>{q.question}</Text>
          <View style={styles.options}>
            {q.options.map((o) => {
              const on = picked[q.question]?.includes(o.label);
              return (
                <Button
                  key={o.label}
                  label={o.label}
                  compact
                  disabled={!pending}
                  variant={on ? "primary" : "secondary"}
                  onPress={() => toggle(q.question, o.label, q.multiSelect)}
                />
              );
            })}
          </View>
        </View>
      ))}
      {pending ? (
        <View style={styles.actions}>
          {questions.length ? (
            <>
              <Button
                label="Skip"
                variant="ghost"
                compact
                onPress={() => respond(item.id, { decision: "deny" })}
              />
              <Button
                label="Answer"
                compact
                disabled={!complete}
                onPress={() =>
                  respond(item.id, {
                    decision: "answer",
                    answers: Object.fromEntries(
                      questions.map((q) => [
                        q.question,
                        (picked[q.question] ?? []).join(", "),
                      ])
                    ),
                  })
                }
              />
            </>
          ) : (
            <>
              <Button
                label="Deny"
                variant="destructive"
                compact
                onPress={() => respond(item.id, { decision: "deny" })}
              />
              {item.canAlways ? (
                <Button
                  label="Always"
                  variant="secondary"
                  compact
                  onPress={() => respond(item.id, { decision: "always" })}
                />
              ) : null}
              <Button
                label="Allow"
                compact
                onPress={() => respond(item.id, { decision: "allow" })}
              />
            </>
          )}
        </View>
      ) : (
        <Text style={[styles.done, { color: t.muted }]}>
          {item.status === "answered" ? "Answered" : item.status}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.md,
    gap: space.md,
  },
  head: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  title: { flex: 1, fontSize: font.size.md, fontWeight: "600" },
  q: { fontSize: font.size.md, lineHeight: 21 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.sm },
  done: { fontSize: font.size.xs, textTransform: "capitalize" },
});
