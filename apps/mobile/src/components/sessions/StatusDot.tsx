import { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import { useTheme } from "~/lib/theme";

export function StatusDot({ row }: { row: SidebarRow }) {
  const t = useTheme();
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = row.working
      ? withRepeat(withTiming(0.35, { duration: 900 }), -1, true)
      : 1;
  }, [row.working, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const color = row.need
    ? t.warning
    : row.working
      ? t.primary
      : row.status?.status === "error"
        ? t.destructive
        : row.unread
          ? t.primary
          : t.faint;
  const hollow = !row.need && !row.working && !row.unread;
  return (
    <Animated.View
      style={[
        {
          width: 9,
          height: 9,
          borderRadius: 5,
          backgroundColor: hollow ? "transparent" : color,
          borderWidth: hollow ? 1.5 : 0,
          borderColor: color,
        },
        style,
      ]}
    />
  );
}
