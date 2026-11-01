import { checkUpload } from "../attachments/check";
import {
  ATTACHMENT_LIMITS,
  tooBigMessage,
  typeFor,
} from "../attachments/policy";
import { prepareUpload } from "../attachments/prepare";
import { sniff } from "./sniff";

export interface AcceptedFile {
  name: string;
  data: Buffer;
  kind: "image" | "pdf" | "sheet" | "doc" | "text" | "video";
  mediaType: string;
  // Beside the saved file, given to the agent with its path.
  summary?: string;
}

export class RefusedFile extends Error {
  constructor(
    public status: 400 | 413 | 415,
    message: string
  ) {
    super(message);
  }
}

/**
 * What a shared file becomes, by the same server-owned policy as a chat
 * attachment: allow-listed by extension or whole name, per-kind size limits,
 * HAR secrets redacted, HEIC converted. A name off the list is taken only when
 * its bytes are an image, a PDF or a video; executables and other binaries are
 * refused, and a script on the list is kept as text and never run.
 */
export async function acceptFile(
  name: string,
  data: Buffer
): Promise<AcceptedFile> {
  const type = typeFor(name);
  if (type) {
    const checked = checkUpload(name, data);
    if (!checked.ok) throw new RefusedFile(checked.status, checked.error);
    const prepared = await prepareUpload(checked.type, name, data);
    if (!prepared.ok) throw new RefusedFile(prepared.status, prepared.error);
    return prepared;
  }
  const kind = sniff(data, name);
  if (kind && kind.kind !== "text") {
    const limit =
      kind.kind === "image" && kind.mediaType !== "image/heic"
        ? ATTACHMENT_LIMITS.maxImageBytes
        : ATTACHMENT_LIMITS.maxBytes;
    if (data.length > limit)
      throw new RefusedFile(413, tooBigMessage(name, data.length, limit));
    return { name, data, kind: kind.kind, mediaType: kind.mediaType };
  }
  throw new RefusedFile(415, `Can't take ${name.split(/[\\/]/).pop()}`);
}
