import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import { checkUpload } from "@/lib/attachments/check";
import { ATTACHMENT_LIMITS, tooBigMessage } from "@/lib/attachments/policy";
import { prepareUpload } from "@/lib/attachments/prepare";
import { saveAttachment } from "@/lib/attachments/store";
import { peerChatLink } from "@/lib/chat/peer-relay";

// Base64 is a third bigger than the bytes, and the JSON around it is small.
const MAX_BODY =
  Math.ceil((ATTACHMENT_LIMITS.maxTextBytes * 4) / 3) + 64 * 1024;

const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

// POST /api/files/upload-temp { filename, base64, mimeType?, sessionId? }
// Without a sessionId the file goes to the shared temp folder (the terminal's
// drop, the file picker). With one - a session's id, or "draft" for a chat
// not started yet - it is checked against lib/attachments/policy and kept in
// that session's attachments folder, outside any repo.
export async function POST(request: Request) {
  try {
    const length = Number(request.headers.get("content-length"));
    if (length > MAX_BODY)
      return fail(
        tooBigMessage("That file", length, ATTACHMENT_LIMITS.maxBytes),
        413
      );
    const { filename, base64, sessionId } = await request.json();

    if (typeof base64 !== "string" || !base64) return fail("No file data", 400);
    const name =
      typeof filename === "string" && filename ? filename : "attachment";
    const buffer = Buffer.from(base64, "base64");
    const checked = checkUpload(name, buffer);
    if (!checked.ok) return fail(checked.error, checked.status);
    const prepared = await prepareUpload(checked.type, name, buffer);
    if (!prepared.ok) return fail(prepared.error, prepared.status);

    if (typeof sessionId === "string" && sessionId) {
      if (sessionId !== "draft" && peerChatLink(sessionId))
        return fail(
          "Files can't be attached to a session running on another machine yet. Images still work.",
          409
        );
      const file = saveAttachment(
        sessionId,
        prepared.name,
        prepared.data,
        prepared.mediaType,
        prepared.summary
      );
      return NextResponse.json({ ...file, kind: prepared.kind });
    }

    const tempDir = path.join(os.tmpdir(), "agent-os-screenshots");
    await mkdir(tempDir, { recursive: true });
    const safeName = prepared.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const filePath = path.join(tempDir, `${Date.now()}-${safeName}`);
    await writeFile(filePath, prepared.data);

    return NextResponse.json({
      path: filePath,
      name: safeName,
      size: prepared.data.length,
      mediaType: prepared.mediaType,
      kind: prepared.kind,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return fail("Failed to save the file", 500);
  }
}
