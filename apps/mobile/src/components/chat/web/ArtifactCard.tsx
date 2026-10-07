import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "~/components/ui/Icon";
import { Text } from "~/components/ui/Text";
import { authHeaders } from "~/lib/api/client";
import { haptic } from "~/lib/haptics";
import type { Machine } from "~/lib/machines/store";
import { font, HIT, radius, space, useTheme } from "~/lib/theme";
import { SandboxWeb } from "./SandboxWeb";

export const artifactUrl = (machine: Machine, id: string) =>
  `${machine.url}/api/artifacts/${encodeURIComponent(id)}`;

// A page an agent showed with html_render: inline at its own height (up to
// a cap), and full screen from the corner button.
export function ArtifactCard({
  machine,
  artifactId,
  title,
  height,
}: {
  machine: Machine;
  artifactId: string;
  title: string;
  height?: number;
}) {
  const t = useTheme();
  const url = artifactUrl(machine, artifactId);
  return (
    <View style={[styles.wrap, { backgroundColor: t.wash }]}>
      <View style={styles.head}>
        <Icon name="macwindow" size={13} color={t.muted} />
        <Text numberOfLines={1} style={[styles.title, { color: t.foreground }]}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open full screen"
          onPress={() => {
            haptic.tap();
            router.push({
              pathname: "/artifact",
              params: { id: artifactId, title },
            });
          }}
          style={styles.btn}
        >
          <Icon
            name="arrow.up.left.and.arrow.down.right"
            size={14}
            color={t.muted}
          />
        </Pressable>
      </View>
      <SandboxWeb
        source={{ uri: url, headers: authHeaders(machine) }}
        home={url}
        maxHeight={Math.min(height ?? 520, 520)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.xl, overflow: "hidden" },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingLeft: space.md,
  },
  title: { flex: 1, fontSize: font.size.sm, fontWeight: "500" },
  btn: {
    width: HIT,
    height: HIT,
    alignItems: "center",
    justifyContent: "center",
  },
});
