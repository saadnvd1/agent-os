import type { AttachmentKind } from "./attachments/policy";
import type { ChatFile } from "./attachments/types";

export type UploadResult =
  | { ok: true; file: ChatFile; kind: AttachmentKind }
  | { ok: false; error: string };

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a file through /api/files/upload-temp. With a `sessionId` (or
 * "draft") the server checks it against its attachment limits and keeps it in
 * that session's attachments folder; without one it goes to temp storage.
 * The error is the server's own message, ready to show.
 */
export async function uploadFile(
  file: File,
  sessionId?: string
): Promise<UploadResult> {
  try {
    const res = await fetch("/api/files/upload-temp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name || `file-${Date.now()}`,
        base64: await toBase64(file),
        mimeType: file.type || "application/octet-stream",
        sessionId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.path)
      return {
        ok: true,
        kind: data.kind,
        file: {
          path: data.path,
          name: data.name,
          size: data.size,
          mediaType: data.mediaType,
        },
      };
    return {
      ok: false,
      error: data.error ?? `Couldn't upload ${file.name} (${res.status})`,
    };
  } catch {
    return { ok: false, error: `Couldn't upload ${file.name}` };
  }
}

/** The saved path, or null when the upload failed (terminal and picker). */
export async function uploadFileToTemp(
  file: File,
  sessionId?: string
): Promise<string | null> {
  const r = await uploadFile(file, sessionId);
  if (r.ok) return r.file.path;
  console.error("Upload failed:", r.error);
  return null;
}
