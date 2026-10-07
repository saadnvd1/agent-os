import { router } from "expo-router";
import { useRef } from "react";
import {
  ActionSheetIOS,
  Alert,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
} from "react-native";
import Swipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { Text } from "~/components/ui/Text";
import { compactTimeAgo, fromSqliteTime } from "@/lib/session-meta";
import { NEED_LABEL, type SidebarRow } from "@/lib/sidebar/shelves";
import { Icon } from "~/components/ui/Icon";
import { haptic } from "~/lib/haptics";
import { useActiveMachine, type Machine } from "~/lib/machines/store";
import { useSessionActions } from "~/lib/sessions/actions";
import { font, radius, space, useTheme } from "~/lib/theme";
import { StatusDot } from "./StatusDot";

interface Props {
  row: SidebarRow;
  project: string;
  nested?: boolean;
}

export function SessionRow(props: Props) {
  const machine = useActiveMachine();
  // Rows only list a machine's sessions, so there is always one.
  return machine ? <ActionRow {...props} machine={machine} /> : null;
}

// Swipe right to pin, left for Done; touch and hold, or VoiceOver actions,
// for the same.
function ActionRow({ machine, ...props }: Props & { machine: Machine }) {
  const t = useTheme();
  const s = props.row.session;
  const { pin, done } = useSessionActions(machine);
  const swipe = useRef<SwipeableMethods>(null);
  const togglePin = () => {
    swipe.current?.close();
    pin.mutate({ id: s.id, pinned: !s.pinned });
  };
  const finish = () => {
    swipe.current?.close();
    Alert.alert(
      `Done with “${s.name}”?`,
      "Stops the agent and archives the session. A task with an open pull request merges first, through the orchestrator's gates.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Done",
          style: "destructive",
          onPress: () =>
            done.mutate(s.id, {
              onError: (err) => Alert.alert("Not done", err.message),
            }),
        },
      ]
    );
  };
  const pinLabel = s.pinned ? "Unpin" : "Pin";
  const menu = () => {
    haptic.press();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: s.name,
        options: [pinLabel, "Done", "Cancel"],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (i) => (i === 0 ? togglePin() : i === 1 ? finish() : undefined)
    );
  };
  const action = (
    label: string,
    icon: Parameters<typeof Icon>[0]["name"],
    color: string,
    onPress: () => void
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.action, { backgroundColor: color }]}
    >
      <Icon name={icon} size={18} color={t.onPrimary} />
      <Text style={[styles.actionText, { color: t.onPrimary }]}>{label}</Text>
    </Pressable>
  );
  return (
    <Swipeable
      ref={swipe}
      friction={1.5}
      overshootFriction={8}
      renderLeftActions={() => action(pinLabel, "pin", t.primary, togglePin)}
      renderRightActions={() => action("Done", "checkmark", t.success, finish)}
      onSwipeableWillOpen={() => haptic.tap()}
    >
      <RowBody
        {...props}
        onPress={() =>
          router.push({
            pathname: "/session/[id]",
            params: { id: s.id, name: s.name },
          })
        }
        onLongPress={menu}
        accessibilityActions={[
          { name: "pin", label: pinLabel },
          { name: "done", label: "Done" },
        ]}
        onAccessibilityAction={(e) =>
          e.nativeEvent.actionName === "pin" ? togglePin() : finish()
        }
      />
    </Swipeable>
  );
}

function RowBody({
  row,
  project,
  nested,
  ...press
}: Props &
  Pick<
    PressableProps,
    "onPress" | "onLongPress" | "accessibilityActions" | "onAccessibilityAction"
  >) {
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
      {...press}
      onPress={(e) => {
        haptic.tap();
        press.onPress?.(e);
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
        <View style={styles.meta}>
          {row.unread ? (
            <View style={[styles.unread, { backgroundColor: t.primary }]} />
          ) : null}
          <Text style={[styles.time, { color: t.faint }]}>
            {compactTimeAgo(fromSqliteTime(s.updated_at))}
          </Text>
        </View>
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
  action: {
    width: 84,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  actionText: { fontSize: font.size.xs, fontWeight: "600" },
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
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  unread: { width: 7, height: 7, borderRadius: 4 },
  time: { fontSize: font.size.xs, fontVariant: ["tabular-nums"] },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  badgeText: { fontSize: font.size.xs, fontWeight: "600" },
});
