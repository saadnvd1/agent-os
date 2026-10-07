import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "./Icon";
import { haptic } from "~/lib/haptics";
import { font, space, useTheme } from "~/lib/theme";

// One choice in a grouped list, with a check when it's the current one.
export function OptionRow({
  label,
  detail,
  selected,
  onPress,
  onLongPress,
}: {
  label: string;
  detail?: string;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? t.secondary : t.card },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={[styles.label, { color: t.foreground }]}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={1} style={[styles.detail, { color: t.muted }]}>
            {detail}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <Icon name="checkmark" size={16} color={t.primary} weight="semibold" />
      ) : null}
    </Pressable>
  );
}

export function GroupTitle({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Text style={[styles.group, { color: t.muted }]}>
      {children.toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  label: { fontSize: font.size.md },
  detail: { fontSize: font.size.xs },
  group: {
    fontSize: font.size.xs,
    fontWeight: "600",
    letterSpacing: 0.6,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
});
