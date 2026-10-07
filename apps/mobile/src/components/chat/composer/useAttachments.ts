import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import type { ChatImage } from "@/lib/chat/events";
import { haptic } from "~/lib/haptics";

export interface Attachment extends ChatImage {
  uri: string;
}

// Photos from the library, as base64 for the send message (the web sends
// the same shape, without a data: prefix).
export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([]);

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: 4,
    });
    if (res.canceled) return;
    const picked = res.assets
      .filter((a) => a.base64)
      .map((a) => ({
        uri: a.uri,
        mediaType: a.mimeType ?? "image/jpeg",
        data: a.base64!.replace(/^data:[^,]+,/, ""),
      }));
    if (picked.length) haptic.tap();
    setItems((cur) => [...cur, ...picked].slice(0, 8));
  };

  return {
    items,
    pick,
    remove: (uri: string) =>
      setItems((cur) => cur.filter((a) => a.uri !== uri)),
    clear: () => setItems([]),
  };
}
