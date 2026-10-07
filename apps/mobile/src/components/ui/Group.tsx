import { StyleSheet, View } from "react-native";
import { radius, space, useTheme } from "~/lib/theme";

// A rounded inset group of rows with hairline separators, like Settings.
export function Group({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(
    Boolean
  );
  return (
    <View style={[styles.group, { backgroundColor: t.card }]}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? (
            <View style={[styles.sep, { backgroundColor: t.border }]} />
          ) : null}
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    marginHorizontal: space.lg,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: space.lg },
});
