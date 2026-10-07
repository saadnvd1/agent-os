import { Stack } from "expo-router";
import { useTheme } from "~/lib/theme";

export default function Layout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerLargeTitleEnabled: true,
        headerTransparent: true,
        headerTintColor: t.primary,
        headerLargeTitleShadowVisible: false,
        headerLargeTitleStyle: {
          color: t.foreground,
          fontFamily: "Geist_700Bold",
        },
        headerTitleStyle: {
          color: t.foreground,
          fontFamily: "Geist_600SemiBold",
        },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Needs you" }} />
    </Stack>
  );
}
