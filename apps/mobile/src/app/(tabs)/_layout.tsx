import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useMachineAsks } from "~/components/asks/useMachineAsks";
import { useTheme } from "~/lib/theme";

export default function TabsLayout() {
  const t = useTheme();
  const asks = useMachineAsks();
  return (
    <NativeTabs tintColor={t.primary} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="sessions">
        <NativeTabs.Trigger.Icon
          sf={{
            default: "bubble.left.and.text.bubble.right",
            selected: "bubble.left.and.text.bubble.right.fill",
          }}
        />
        <NativeTabs.Trigger.Label>Sessions</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="needs">
        <NativeTabs.Trigger.Icon
          sf={{ default: "bell", selected: "bell.fill" }}
        />
        <NativeTabs.Trigger.Label>Needs you</NativeTabs.Trigger.Label>
        {asks.count ? (
          <NativeTabs.Trigger.Badge>
            {String(asks.count)}
          </NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="machines">
        <NativeTabs.Trigger.Icon
          sf={{ default: "desktopcomputer", selected: "desktopcomputer" }}
        />
        <NativeTabs.Trigger.Label>Machines</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
