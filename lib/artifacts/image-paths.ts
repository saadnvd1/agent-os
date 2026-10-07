// Which paths chat shows as images, and the URL it loads them from. No Node
// imports: the chat UI uses this too.

export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

const IMAGE_PATH = /^(?:\/|~\/)[^\0\n]*\.(png|jpe?g|gif|webp|avif|svg)$/i;

// The image type of an absolute (or ~/) path to an image file, else null.
export function imageType(p: string): string | null {
  const ext = IMAGE_PATH.exec(p.trim())?.[1];
  return ext ? IMAGE_TYPES[ext.toLowerCase()] : null;
}

export const imageUrl = (p: string) =>
  `/api/files/image?path=${encodeURIComponent(p.trim())}`;
