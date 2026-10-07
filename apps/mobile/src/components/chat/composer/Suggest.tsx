import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { insertCommand, rankCommands, slashQuery } from "@/lib/chat/commands";
import type { ChatCommand, FileSuggestion } from "@/lib/chat/events";
import { mentionQuery, mentionText } from "@/lib/chat/mentions";
import { Text } from "~/components/ui/Text";
import type { ChatCaps } from "~/lib/chat/reducer";
import { haptic } from "~/lib/haptics";
import { font, HIT, radius, space, useTheme } from "~/lib/theme";

export interface Suggestion {
  key: string;
  label: string;
  hint?: string;
  pick: () => void;
}

// The web's own /model, handled here rather than sent.
const MODEL: ChatCommand = {
  name: "model",
  description: "Switch the model",
  builtin: true,
};

// The slash menu while the message is just "/word", and @file mentions at
// the caret: the same rules and ranking as the web composer.
export function useSuggestions({
  text,
  caret,
  setText,
  setCaret,
  caps,
  findFiles,
  openModels,
}: {
  text: string;
  caret: number;
  setText: (v: string) => void;
  setCaret: (at: number) => void;
  caps: ChatCaps | null;
  findFiles: (q: string) => Promise<FileSuggestion[]>;
  openModels: () => void;
}): Suggestion[] {
  const slash = slashQuery(text);
  const mention = slash === null ? mentionQuery(text.slice(0, caret)) : null;
  const [files, setFiles] = useState<{ q: string; f: FileSuggestion[] }>();

  const q = mention?.query;
  useEffect(() => {
    if (q === undefined) return;
    let live = true;
    const timer = setTimeout(
      () => void findFiles(q).then((f) => live && setFiles({ q, f })),
      80
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, findFiles]);

  if (slash !== null) {
    const commands = [
      ...(caps && caps.models.length > 1 ? [MODEL] : []),
      ...(caps?.commands ?? []),
    ];
    return rankCommands(slash, commands, 8).map((c) => ({
      key: c.name,
      label: `/${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ""}`,
      hint: c.description,
      pick: () => {
        if (c === MODEL) {
          setText("");
          openModels();
        } else {
          const next = insertCommand(c.name);
          setText(next);
          setCaret(next.length);
        }
      },
    }));
  }
  if (mention && files?.q === mention.query) {
    return files.f.slice(0, 8).map((f) => {
      const slashAt = f.path.lastIndexOf("/");
      return {
        key: f.path,
        label: f.path.slice(slashAt + 1) + (f.dir ? "/" : ""),
        hint: slashAt > 0 ? f.path.slice(0, slashAt) : undefined,
        pick: () => {
          const head = text.slice(0, mention.start) + mentionText(f);
          setText(head + text.slice(caret));
          setCaret(head.length);
        },
      };
    });
  }
  return [];
}

export function SuggestionList({ items }: { items: Suggestion[] }) {
  const t = useTheme();
  if (!items.length) return null;
  return (
    <View
      style={[
        styles.list,
        { backgroundColor: t.card, borderColor: t.hairline },
      ]}
    >
      <ScrollView keyboardShouldPersistTaps="always">
        {items.map((s) => (
          <Pressable
            key={s.key}
            accessibilityRole="button"
            accessibilityLabel={s.hint ? `${s.label}, ${s.hint}` : s.label}
            onPress={() => {
              haptic.tap();
              s.pick();
            }}
            style={({ pressed }) => [
              styles.row,
              pressed && { backgroundColor: t.wash },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.label, { color: t.foreground }]}
            >
              {s.label}
            </Text>
            {s.hint ? (
              <Text numberOfLines={1} style={[styles.hint, { color: t.muted }]}>
                {s.hint}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    maxHeight: 240,
    marginBottom: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    minHeight: HIT,
    justifyContent: "center",
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  label: { fontFamily: font.mono, fontSize: font.size.sm },
  hint: { fontSize: font.size.xs, marginTop: 1 },
});
