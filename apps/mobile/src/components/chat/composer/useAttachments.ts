import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActionSheetIOS, Alert } from "react-native";
import { haptic } from "~/lib/haptics";
import { prepareImage, type Prepared } from "./compress";

export type Attachment = Prepared;
const MAX_ATTACHMENTS = 8;

// Images from the library, the camera, Files or the clipboard; several at a
// time, previewed in the composer and removable before sending.
export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);

  const add = async (sources: { uri: string; mime?: string | null }[]) => {
    if (!sources.length) return;
    setBusy(true);
    try {
      const prepared = await Promise.all(
        sources.map((s) => prepareImage(s.uri, s.mime))
      );
      setItems((cur) =>
        [...cur, ...prepared.filter((p) => p.data)].slice(0, MAX_ATTACHMENTS)
      );
      haptic.tap();
    } catch {
      haptic.warn();
      Alert.alert("Couldn't attach that image");
    } finally {
      setBusy(false);
    }
  };

  const fromLibrary = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_ATTACHMENTS,
      quality: 1,
    });
    if (!res.canceled)
      await add(res.assets.map((a) => ({ uri: a.uri, mime: a.mimeType })));
  };

  const fromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted)
      return Alert.alert(
        "Camera access is off",
        "Turn it on in Settings to take a photo."
      );
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (!res.canceled)
      await add(res.assets.map((a) => ({ uri: a.uri, mime: a.mimeType })));
  };

  const fromFiles = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: "image/*",
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (!res.canceled)
      await add(res.assets.map((a) => ({ uri: a.uri, mime: a.mimeType })));
  };

  const fromClipboard = async () => {
    const img = await Clipboard.getImageAsync({ format: "png" });
    if (img?.data) await add([{ uri: img.data, mime: "image/png" }]);
  };

  const pick = async () => {
    const canPaste = await Clipboard.hasImageAsync().catch(() => false);
    const options = [
      { label: "Photo Library", run: fromLibrary },
      { label: "Take Photo", run: fromCamera },
      { label: "Choose File", run: fromFiles },
      ...(canPaste ? [{ label: "Paste Image", run: fromClipboard }] : []),
    ];
    haptic.tap();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...options.map((o) => o.label), "Cancel"],
        cancelButtonIndex: options.length,
      },
      (i) => void options[i]?.run()
    );
  };

  return {
    items,
    busy,
    pick,
    pasteImage: fromClipboard,
    remove: (uri: string) =>
      setItems((cur) => cur.filter((a) => a.uri !== uri)),
    clear: () => setItems([]),
  };
}
