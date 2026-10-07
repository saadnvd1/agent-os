import { StyleSheet, View } from "react-native";
import { Text } from "~/components/ui/Text";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useConnect } from "~/components/connect/useConnect";
import { Button } from "~/components/ui/Button";
import { Field } from "~/components/ui/Field";
import { Icon } from "~/components/ui/Icon";
import { font, radius, space, useTheme } from "~/lib/theme";

export default function ConnectScreen() {
  const t = useTheme();
  const c = useConnect();
  const pairing = c.step.kind === "pair";

  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: t.background }}
      contentContainerStyle={styles.wrap}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      <View style={[styles.mark, { backgroundColor: t.primary }]}>
        <Icon
          name={pairing ? "lock.shield" : "desktopcomputer"}
          size={30}
          color={t.onPrimary}
        />
      </View>
      <Text style={[styles.title, { color: t.foreground }]}>
        {pairing ? "Pair this phone" : "Connect to AgentOS"}
      </Text>
      <Text style={[styles.body, { color: t.muted }]}>
        {pairing
          ? "On the web app, open Devices and tap Add a device. Enter the code it shows."
          : "Enter the address you open AgentOS at: a tailnet IP, a .ts.net name, or a Connect address."}
      </Text>

      {pairing ? (
        <View style={styles.form}>
          <Field
            label="Pairing code"
            mono
            value={c.code}
            onChangeText={c.setCode}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoCapitalize="characters"
            autoFocus
            returnKeyType="go"
            onSubmitEditing={c.submitCode}
          />
          <Field
            label="Name this phone"
            value={c.name}
            onChangeText={c.setName}
            hint="It's how this phone shows up in Devices."
          />
        </View>
      ) : (
        <View style={styles.form}>
          <Field
            label="Address"
            value={c.address}
            onChangeText={c.setAddress}
            placeholder="100.64.0.1:3011 or mac.tailnet.ts.net:3443"
            keyboardType="url"
            textContentType="URL"
            autoFocus
            returnKeyType="go"
            onSubmitEditing={c.submitAddress}
            hint="A pairing link from Add a device works here too."
          />
          {__DEV__ ? (
            <Button
              label="Use this Mac (simulator)"
              variant="ghost"
              compact
              onPress={() => c.setAddress("http://127.0.0.1:3011")}
            />
          ) : null}
        </View>
      )}

      {c.error ? (
        <View style={[styles.error, { backgroundColor: t.destructiveSoft }]}>
          <Icon
            name="exclamationmark.triangle.fill"
            size={14}
            color={t.destructive}
          />
          <Text style={[styles.errorText, { color: t.destructive }]}>
            {c.error}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={pairing ? "Pair" : "Continue"}
          busy={c.busy}
          disabled={
            pairing
              ? c.code.replace(/[^0-9a-z]/gi, "").length < 16
              : !c.address.trim()
          }
          onPress={pairing ? c.submitCode : c.submitAddress}
        />
        {pairing ? (
          <Button
            label="Use another address"
            variant="ghost"
            onPress={c.back}
          />
        ) : null}
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.md, paddingTop: space.xxl },
  mark: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: space.sm,
  },
  title: { fontSize: font.size.title, fontWeight: "700", textAlign: "center" },
  body: {
    fontSize: font.size.md,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: space.md,
  },
  form: { gap: space.lg },
  error: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "center",
    padding: space.md,
    borderRadius: radius.md,
  },
  errorText: { flex: 1, fontSize: font.size.sm },
  actions: { gap: space.sm, marginTop: space.md },
});
