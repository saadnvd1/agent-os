import { StyleSheet, Text, View } from "react-native";
import type { ChatItem } from "@/lib/chat/events";
import { Icon } from "~/components/ui/Icon";
import { font, radius, space, useTheme } from "~/lib/theme";

type TodosItem = Extract<ChatItem, { kind: "todos" }>;

export function Todos({ item }: { item: TodosItem }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.card }]}>
      {item.todos.map((todo, i) => (
        <View key={i} style={styles.row}>
          <Icon
            name={
              todo.status === "completed"
                ? "checkmark.circle.fill"
                : todo.status === "in_progress"
                  ? "circle.dotted"
                  : "circle"
            }
            size={15}
            color={todo.status === "pending" ? t.faint : t.primary}
          />
          <Text
            style={[
              styles.text,
              { color: todo.status === "completed" ? t.muted : t.foreground },
              todo.status === "completed" && styles.done,
            ]}
          >
            {todo.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, padding: space.md, gap: space.sm },
  row: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  text: { flex: 1, fontSize: font.size.sm, lineHeight: 19 },
  done: { textDecorationLine: "line-through" },
});
