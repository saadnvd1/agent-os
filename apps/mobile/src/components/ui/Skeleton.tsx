import { useEffect } from "react";
import { type DimensionValue, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { radius, space, useTheme } from "~/lib/theme";

export function Skeleton({
  width,
  height = 14,
}: {
  width: DimensionValue;
  height?: number;
}) {
  const t = useTheme();
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius.sm,
          backgroundColor: t.secondary,
        },
        style,
      ]}
    />
  );
}

// A list's first load: rows shaped like the real ones.
export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <View
      style={{
        paddingHorizontal: space.lg,
        gap: space.xl,
        paddingTop: space.lg,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}
        >
          <Skeleton width={10} height={10} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton width={`${55 + ((i * 17) % 35)}%`} />
            <Skeleton width="35%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}
