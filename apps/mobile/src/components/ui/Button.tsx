import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { SymbolViewProps } from "expo-symbols";
import { haptic } from "~/lib/haptics";
import { font, HIT, radius, space, useTheme } from "~/lib/theme";
import { Icon } from "./Icon";

type Variant = "primary" | "secondary" | "destructive" | "ghost";

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: SymbolViewProps["name"];
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  busy,
  compact,
}: Props) {
  const t = useTheme();
  const bg = {
    primary: t.primary,
    secondary: t.secondary,
    destructive: t.destructiveSoft,
    ghost: "transparent",
  }[variant];
  const fg = {
    primary: t.onPrimary,
    secondary: t.foreground,
    destructive: t.destructive,
    ghost: t.primary,
  }[variant];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={() => {
        haptic.press();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.75 : 1 },
      ]}
    >
      <View style={styles.row}>
        {busy ? (
          <ActivityIndicator color={fg} size="small" />
        ) : icon ? (
          <Icon name={icon} size={16} color={fg} weight="semibold" />
        ) : null}
        <Text style={[styles.label, { color: fg }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: HIT,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  compact: { paddingHorizontal: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  label: { fontSize: font.size.md, fontWeight: "600" },
});
