// Share (or save, from the share sheet) an image the app is showing: a
// data: URI is written to the cache first, a remote one is downloaded.
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

async function localFile(uri: string): Promise<string> {
  if (uri.startsWith("file:")) return uri;
  const data = uri.match(/^data:([^;,]+);base64,(.*)$/s);
  if (data) {
    const file = new File(
      Paths.cache,
      `image-${Date.now()}.${EXT[data[1]] ?? "jpg"}`
    );
    file.write(data[2], { encoding: "base64" });
    return file.uri;
  }
  const file = await File.downloadFileAsync(
    uri,
    new File(Paths.cache, `image-${Date.now()}`)
  );
  return file.uri;
}

export async function shareImage(uri: string): Promise<void> {
  await Sharing.shareAsync(await localFile(uri));
}
