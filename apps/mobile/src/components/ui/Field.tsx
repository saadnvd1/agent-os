import { forwardRef } from "react";
import {
  StyleSheet,
  type TextInput as RNTextInput,
  type TextInputProps,
  View,
} from "react-native";
import { Text, TextInput } from "~/components/ui/Text";
import { font, radius, space, useTheme } from "~/lib/theme";

type Props = TextInputProps & { label: string; hint?: string; mono?: boolean };

export const Field = forwardRef<RNTextInput, Props>(function Field(
  { label, hint, mono, style, ...rest },
  ref
) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[styles.label, { color: t.muted }]}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={t.faint}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          { backgroundColor: t.card, color: t.foreground },
          mono && { fontFamily: font.mono, letterSpacing: 1 },
          style,
        ]}
        {...rest}
      />
      {hint ? (
        <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  label: { fontSize: font.size.sm, fontWeight: "600" },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    fontSize: font.size.md,
  },
  hint: { fontSize: font.size.xs, lineHeight: 17 },
});
