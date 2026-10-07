import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ToolItem } from "@/lib/chat/group";
import { Icon } from "~/components/ui/Icon";
import { haptic } from "~/lib/haptics";
import { font, radius, space, useTheme } from "~/lib/theme";
import { DiffView } from "./DiffView";
import { ToolStep } from "./ToolStep";

// A run of tool calls folded into one line; edits keep their diffs visible.
export function ToolGroup({ tools }: { tools: ToolItem[] }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const running = tools.some((x) => x.status === "running");
  const failed = tools.filter((x) => x.status === "error").length;
  const last = tools[tools.length - 1];
  const diffs = tools.filter((x) => x.diff);
  const label = `${tools.length} ${tools.length === 1 ? "step" : "steps"}${failed ? ` · ${failed} failed` : ""}`;
  return (
    <View style={[styles.wrap, { backgroundColor: t.card }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          haptic.tap();
          setOpen((o) => !o);
        }}
        style={styles.head}
      >
        {running ? (
          <ActivityIndicator size="small" color={t.primary} />
        ) : (
          <Icon name="wrench.and.screwdriver" size={14} color={t.muted} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: t.foreground }]}>{label}</Text>
          {!open ? (
            <Text numberOfLines={1} style={[styles.last, { color: t.muted }]}>
              {last.title}
            </Text>
          ) : null}
        </View>
        <Icon
          name={open ? "chevron.up" : "chevron.down"}
          size={12}
          color={t.faint}
        />
      </Pressable>
      {open ? (
        <View style={styles.steps}>
          {tools.map((tool) => (
            <ToolStep key={tool.id} tool={tool} />
          ))}
        </View>
      ) : (
        diffs.slice(-2).map((x) => (
          <View key={x.id} style={styles.steps}>
            <DiffView diff={x.diff!} />
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.md, overflow: "hidden" },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    minHeight: 48,
  },
  label: { fontSize: font.size.sm, fontWeight: "600" },
  last: { fontSize: font.size.xs, fontFamily: font.mono, marginTop: 2 },
  steps: {
    paddingHorizontal: space.md,
    paddingBottom: space.md,
    gap: space.xs,
  },
});
