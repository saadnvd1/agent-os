import { router } from "expo-router";
import {
  ActionSheetIOS,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "~/components/ui/Button";
import { Group } from "~/components/ui/Group";
import { GroupTitle, OptionRow } from "~/components/ui/OptionRow";
import { haptic } from "~/lib/haptics";
import {
  removeMachine,
  setActiveMachine,
  useActiveMachine,
  useMachines,
  type Machine,
} from "~/lib/machines/store";
import { font, space, useTheme } from "~/lib/theme";

const VIA: Record<NonNullable<Machine["via"]>, string> = {
  loopback: "This device",
  tailnet: "Tailnet, no pairing needed",
  device: "Paired",
  open: "Open access",
};

export default function MachinesScreen() {
  const t = useTheme();
  const { machines } = useMachines();
  const active = useActiveMachine();

  const confirmRemove = (m: Machine) => {
    haptic.warn();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: m.name,
        message:
          "Forget this machine on this phone. Revoke its pairing in Devices on the web.",
        options: ["Forget machine", "Cancel"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (i) => {
        if (i === 0)
          removeMachine(m.id).then(
            () =>
              !machines.some((x) => x.id !== m.id) && router.replace("/connect")
          );
      }
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: space.xxl }}
    >
      <GroupTitle>Your machines</GroupTitle>
      <Group>
        {machines.map((m) => (
          <OptionRow
            key={m.id}
            label={m.name}
            detail={`${m.url.replace(/^https?:\/\//, "")} · ${VIA[m.via ?? "device"]}`}
            selected={active?.id === m.id}
            onPress={() => setActiveMachine(m.id)}
            onLongPress={() => confirmRemove(m)}
          />
        ))}
      </Group>
      <Text style={[styles.hint, { color: t.muted }]}>
        Tap to switch. Touch and hold to forget one.
      </Text>
      <View style={styles.add}>
        <Button
          label="Add a machine"
          icon="plus"
          variant="secondary"
          onPress={() => router.push("/connect")}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: font.size.xs,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
  },
  add: { paddingHorizontal: space.lg, paddingTop: space.xl },
});
