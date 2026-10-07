import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { ToolItem } from "@/lib/chat/group";
import { Icon } from "~/components/ui/Icon";
import { Text } from "~/components/ui/Text";
import { haptic } from "~/lib/haptics";
import { font, HIT, radius, space, useTheme } from "~/lib/theme";
import { ToolStep } from "./ToolStep";

// A run of tool calls: one quiet line, expandable to every step (as the web).
export function ToolGroup({ tools }: { tools: ToolItem[] }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const running = tools.some((x) => x.status === "running");
  const failed = tools.filter((x) => x.status === "error").length;
  const stopped = tools.filter((x) => x.status === "stopped").length;
  const edits = tools.filter((x) => x.diff).length;
  const latest =
    tools.findLast((x) => x.status === "running") ?? tools[tools.length - 1];
  const label = running
    ? latest.title
    : `${tools.length} step${tools.length === 1 ? "" : "s"}${
        edits ? ` · ${edits} edit${edits === 1 ? "" : "s"}` : ""
      }`;
  return (
    <View style={[styles.wrap, { backgroundColor: t.wash }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          haptic.tap();
          setOpen((o) => !o);
        }}
        style={styles.head}
      >
        <Icon
          name={open ? "chevron.down" : "chevron.right"}
          size={11}
          color={t.muted}
        />
        {running ? <ActivityIndicator size="small" color={t.primary} /> : null}
        <Text numberOfLines={1} style={[styles.label, { color: t.muted }]}>
          {label}
        </Text>
        {failed ? (
          <Text style={[styles.side, { color: t.destructive }]}>
            {failed} failed
          </Text>
        ) : stopped ? (
          <Text style={[styles.side, { color: t.faint }]}>stopped</Text>
        ) : null}
      </Pressable>
      {open ? (
        <View style={styles.steps}>
          {tools.map((tool) => (
            <ToolStep key={tool.id} tool={tool} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: HIT,
    paddingHorizontal: 6,
  },
  label: { flex: 1, fontSize: font.size.xs },
  side: { fontSize: font.size.xs },
  steps: { paddingHorizontal: 6, paddingBottom: space.sm, gap: space.xs },
});
