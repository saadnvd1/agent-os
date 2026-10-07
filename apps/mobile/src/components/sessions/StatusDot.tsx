import { View } from "react-native";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import { useTheme } from "~/lib/theme";

// The web sidebar's dot: amber when it needs you, green with a halo while
// it works, a quiet grey otherwise.
export function StatusDot({ row }: { row: SidebarRow }) {
  const t = useTheme();
  const color = row.need
    ? t.warning
    : row.working
      ? t.running
      : row.status?.status === "error"
        ? t.destructive
        : t.faint;
  return (
    <View
      style={{
        width: 14,
        height: 14,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor:
          row.working && !row.need
            ? "hsla(142, 71%, 45%, 0.25)"
            : "transparent",
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: color,
          opacity: row.need || row.working ? 1 : 0.6,
        }}
      />
    </View>
  );
}
