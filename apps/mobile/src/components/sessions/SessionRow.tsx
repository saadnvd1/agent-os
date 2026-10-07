import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { compactTimeAgo, fromSqliteTime } from "@/lib/session-meta";
import { NEED_LABEL, type SidebarRow } from "@/lib/sidebar/shelves";
import { Icon } from "~/components/ui/Icon";
import { haptic } from "~/lib/haptics";
import { font, radius, space, useTheme } from "~/lib/theme";
import { StatusDot } from "./StatusDot";

interface Props {
  row: SidebarRow;
  project: string;
  nested?: boolean;
}

export function SessionRow({ row, project, nested }: Props) {
  const t = useTheme();
  const s = row.session;
  const detail = row.status?.detail?.slice(0, 200);
  const subtitle = [
    detail,
    s.role === "orchestrator" ? "Orchestrator" : project,
  ]
    .filter(Boolean)
    .join(" · ");
  const icon = s.view === "chat" ? "bubble.left" : "terminal";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${s.name}${row.need ? `, ${NEED_LABEL[row.need]}` : ""}`}
      onPress={() => {
        haptic.tap();
        router.push({
          pathname: "/session/[id]",
          params: { id: s.id, name: s.name },
        });
      }}
      style={({ pressed }) => [
        styles.row,
        nested && styles.nested,
        { backgroundColor: pressed ? t.secondary : "transparent" },
      ]}
    >
      <StatusDot row={row} />
      <View style={styles.text}>
        <Text
          numberOfLines={1}
          style={[
            styles.name,
            { color: t.foreground, fontWeight: row.unread ? "600" : "400" },
          ]}
        >
          {s.name}
        </Text>
        {subtitle ? (
          <View style={styles.subRow}>
            <Icon name={icon} size={11} color={t.faint} />
            <Text numberOfLines={1} style={[styles.sub, { color: t.muted }]}>
              {subtitle}
            </Text>
          </View>
        ) : null}
      </View>
      {row.need ? (
        <View style={[styles.badge, { backgroundColor: t.warningSoft }]}>
          <Text style={[styles.badgeText, { color: t.warning }]}>
            {NEED_LABEL[row.need]}
          </Text>
        </View>
      ) : (
        <Text style={[styles.time, { color: t.faint }]}>
          {compactTimeAgo(fromSqliteTime(s.updated_at))}
        </Text>
      )}
      {row.workers.length ? (
        <Text style={[styles.time, { color: t.muted }]}>
          +{row.workers.length}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  nested: { paddingLeft: space.xxl + space.sm },
  text: { flex: 1, gap: 3 },
  name: { fontSize: font.size.md },
  subRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  sub: { fontSize: font.size.xs, flexShrink: 1 },
  time: { fontSize: font.size.xs, fontVariant: ["tabular-nums"] },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  badgeText: { fontSize: font.size.xs, fontWeight: "600" },
});
