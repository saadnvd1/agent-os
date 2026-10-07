import { ActionSheetIOS, Pressable, StyleSheet } from "react-native";
import type { ChatAccess } from "@/lib/chat/events";
import { Icon } from "~/components/ui/Icon";
import { Text } from "~/components/ui/Text";
import type { ChatCaps } from "~/lib/chat/reducer";
import { haptic } from "~/lib/haptics";
import { font, HIT, radius, space, useTheme } from "~/lib/theme";

// The web's labels (components/Chat/AccessPicker.tsx).
export const ACCESS: Record<
  ChatAccess,
  {
    label: string;
    description: string;
    icon: Parameters<typeof Icon>[0]["name"];
  }
> = {
  ask: {
    label: "Ask first",
    description: "Asks before edits and commands it isn't already allowed",
    icon: "checkmark.shield",
  },
  edits: {
    label: "Accept edits",
    description: "Edits files on its own, asks before other commands",
    icon: "shield",
  },
  full: {
    label: "Full access",
    description: "Does everything without asking",
    icon: "shield.slash",
  },
};

const LEVELS = Object.keys(ACCESS) as ChatAccess[];

export const modelLabel = (caps: ChatCaps) =>
  caps.models.find((m) => m.value === caps.model)?.label ?? caps.model;

// A native sheet listing the choices, the current one ticked.
function choose<T extends string>(
  title: string,
  choices: { value: T; label: string }[],
  current: T,
  pick: (v: T) => void,
  message?: string
) {
  haptic.tap();
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title,
      message,
      options: [
        ...choices.map((c) => (c.value === current ? `✓ ${c.label}` : c.label)),
        "Cancel",
      ],
      cancelButtonIndex: choices.length,
    },
    (i) => {
      const c = choices[i];
      if (c && c.value !== current) pick(c.value);
    }
  );
}

export function pickModel(caps: ChatCaps, set: (m: string) => void) {
  choose("Model", caps.models, caps.model, set);
}

export function Pills({
  caps,
  setModel,
  setAccess,
  setPlan,
}: {
  caps: ChatCaps;
  setModel: (m: string) => void;
  setAccess: (a: ChatAccess) => void;
  setPlan: (p: boolean) => void;
}) {
  const t = useTheme();
  const access = ACCESS[caps.access];
  return (
    <>
      {caps.models.length > 1 ? (
        <Pill
          label={modelLabel(caps)}
          a11y={`Model: ${modelLabel(caps)}`}
          onPress={() => pickModel(caps, setModel)}
        />
      ) : null}
      <Pill
        icon={access.icon}
        label={access.label}
        a11y={`Access: ${access.label}`}
        onPress={() =>
          choose(
            "What it may do without asking",
            LEVELS.map((value) => ({ value, label: ACCESS[value].label })),
            caps.access,
            setAccess,
            LEVELS.map(
              (v) => `${ACCESS[v].label}: ${ACCESS[v].description}.`
            ).join("\n")
          )
        }
      />
      {caps.plan !== null ? (
        <Pill
          icon="list.bullet.clipboard"
          label="Plan"
          a11y="Plan mode"
          on={caps.plan}
          onPress={() => {
            haptic.tap();
            setPlan(!caps.plan);
          }}
          color={caps.plan ? t.primary : undefined}
        />
      ) : null}
    </>
  );
}

function Pill({
  label,
  a11y,
  icon,
  on,
  color,
  onPress,
}: {
  label: string;
  a11y: string;
  icon?: Parameters<typeof Icon>[0]["name"];
  on?: boolean;
  color?: string;
  onPress: () => void;
}) {
  const t = useTheme();
  const fg = color ?? t.muted;
  return (
    <Pressable
      accessibilityRole={on === undefined ? "button" : "switch"}
      accessibilityLabel={a11y}
      accessibilityState={on === undefined ? undefined : { checked: on }}
      hitSlop={{ top: (HIT - 30) / 2, bottom: (HIT - 30) / 2 }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: on
            ? t.primarySoft
            : pressed
              ? t.wash
              : "transparent",
        },
      ]}
    >
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Text numberOfLines={1} style={[styles.label, { color: fg }]}>
        {label}
      </Text>
      {on === undefined ? (
        <Icon name="chevron.down" size={8} color={t.faint} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 30,
    maxWidth: 140,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  label: { fontSize: font.size.xs, flexShrink: 1 },
});
