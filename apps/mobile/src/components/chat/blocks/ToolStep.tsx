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
import { font, radius, space, useTheme } from "~/lib/theme";
import { DiffView } from "./DiffView";

export function ToolStep({ tool }: { tool: ToolItem }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const detail = !!tool.diff || !!tool.output;
  return (
    <View style={{ gap: space.sm }}>
      <Pressable
        disabled={!detail}
        onPress={() => setOpen((o) => !o)}
        style={styles.row}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        {tool.status === "running" ? (
          <ActivityIndicator size="small" color={t.muted} style={styles.icon} />
        ) : (
          <View style={styles.icon}>
            <Icon
              name={
                tool.status === "error"
                  ? "xmark.circle"
                  : tool.status === "stopped"
                    ? "stop.circle"
                    : "checkmark.circle"
              }
              size={14}
              color={tool.status === "error" ? t.destructive : t.faint}
            />
          </View>
        )}
        <Text
          numberOfLines={open ? undefined : 1}
          style={[styles.title, { color: t.muted }]}
        >
          {tool.title}
        </Text>
        {detail ? (
          <Icon
            name={open ? "chevron.up" : "chevron.down"}
            size={11}
            color={t.faint}
          />
        ) : null}
      </Pressable>
      {open && tool.diff ? <DiffView diff={tool.diff} /> : null}
      {open && !tool.diff && tool.output ? (
        <Text
          numberOfLines={30}
          selectable
          style={[styles.output, { color: t.muted, backgroundColor: t.codeBg }]}
        >
          {tool.output}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 44,
  },
  icon: { width: 16, alignItems: "center" },
  title: { flex: 1, fontSize: font.size.sm, fontFamily: font.mono },
  output: {
    fontFamily: font.mono,
    fontSize: 11.5,
    lineHeight: 16,
    padding: space.md,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
});
