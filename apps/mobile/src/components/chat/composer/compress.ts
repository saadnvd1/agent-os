// One path for every picked, shot, chosen or pasted image: scaled to fit
// 2048px on its long side and re-encoded, PNG kept for screenshots (text
// stays crisp), JPEG for photos. Sent as base64, like the web.
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

export const MAX_SIDE = 2048;

export function fitWithin(width: number, height: number, max = MAX_SIDE) {
  const long = Math.max(width, height);
  if (long <= max) return null;
  const k = max / long;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

export interface Prepared {
  uri: string;
  mediaType: string;
  data: string;
}

export async function prepareImage(
  uri: string,
  mime?: string | null
): Promise<Prepared> {
  const png = mime === "image/png";
  const first = await ImageManipulator.manipulate(uri).renderAsync();
  const size = fitWithin(first.width, first.height);
  const ref = size
    ? await ImageManipulator.manipulate(first).resize(size).renderAsync()
    : first;
  const out = await ref.saveAsync({
    base64: true,
    format: png ? SaveFormat.PNG : SaveFormat.JPEG,
    compress: png ? 1 : 0.82,
  });
  return {
    uri: out.uri,
    mediaType: png ? "image/png" : "image/jpeg",
    data: out.base64 ?? "",
  };
}
