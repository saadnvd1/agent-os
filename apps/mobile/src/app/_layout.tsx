import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { loadMachines, useMachines } from "~/lib/machines/store";
import { useTheme } from "~/lib/theme";

// A link straight to a session still gets the tabs underneath to go back to.
export const unstable_settings = { initialRouteName: "(tabs)" };

// React Native warns when a socket we already closed reports its close.
LogBox.ignoreLogs(["Sending `websocketClosed` with no listeners registered"]);

SplashScreen.preventAutoHideAsync().catch(() => {});
loadMachines();

export default function RootLayout() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 2000 } },
      })
  );
  const { ready } = useMachines();
  const t = useTheme();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  const base = t.scheme === "dark" ? DarkTheme : DefaultTheme;
  const nav = {
    ...base,
    colors: {
      ...base.colors,
      primary: t.primary,
      background: t.background,
      card: t.card,
      text: t.foreground,
      border: t.border,
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.background }}>
      <KeyboardProvider preload={false}>
        <QueryClientProvider client={client}>
          <ThemeProvider value={nav}>
            <StatusBar style="auto" />
            {ready ? (
              <Stack
                screenOptions={{
                  headerTintColor: t.primary,
                  headerTitleStyle: { color: t.foreground },
                  headerBackButtonDisplayMode: "minimal",
                }}
              >
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen
                  name="(tabs)"
                  options={{ headerShown: false, title: "Back" }}
                />
                <Stack.Screen
                  name="connect"
                  options={{ title: "Add a machine" }}
                />
                <Stack.Screen name="session/[id]" options={{ title: "" }} />
                <Stack.Screen
                  name="filters"
                  options={{
                    title: "Filter",
                    presentation: "formSheet",
                    sheetAllowedDetents: [0.6, 1],
                    sheetGrabberVisible: true,
                  }}
                />
              </Stack>
            ) : null}
          </ThemeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
