import { StyleSheet, View } from "react-native";
import { Text } from "~/components/ui/Text";
import type { SymbolViewProps } from "expo-symbols";
import { font, space, useTheme } from "~/lib/theme";
import { Icon } from "./Icon";

export function Empty({
  icon,
  title,
  body,
  children,
}: {
  icon: SymbolViewProps["name"];
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={styles.wrap}>
      <Icon name={icon} size={34} color={t.faint} weight="regular" />
      <Text style={[styles.title, { color: t.foreground }]}>{title}</Text>
      {body ? (
        <Text style={[styles.body, { color: t.muted }]}>{body}</Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    padding: space.xxl,
    gap: space.sm,
    paddingTop: 64,
  },
  title: { fontSize: font.size.lg, fontWeight: "600", marginTop: space.sm },
  body: {
    fontSize: font.size.md,
    textAlign: "center",
    lineHeight: 21,
    maxWidth: 300,
  },
});
