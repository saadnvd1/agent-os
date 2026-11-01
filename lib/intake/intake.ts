import fs from "fs";
import path from "path";
import { dataRoot } from "../db/path";
import type { ChatImage } from "../chat/events";
import { chatState, sendChat } from "../chat/runner";
import { ensureOrchestrator, getOrchestrator } from "../orchestrator/home";
import { getWorkspace } from "../workspaces";
import { INTAKE_LIMITS, MAX_INLINE_IMAGE_BYTES } from "./limits";
import { buildIntakeMessage, type IntakeMeta } from "./message";
import { acceptFile, RefusedFile, type AcceptedFile } from "./accept";
import { safeName, summaryPath } from "../attachments/store";
import { formatBytes } from "../attachments/policy";

export class IntakeError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export interface IntakeResult {
  id: string;
  sessionId: string | null;
  delivered: "sent" | "queued";
  dir: string;
}

export interface IntakeFile {
  name: string;
  data: Buffer;
}

const ID = /^[A-Za-z0-9-]{8,64}$/;
const DAY = 86_400_000;

const segment = (s: string) => s.replace(/[^\w-]/g, "_");
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

const workspaceRoot = (workspaceId: string) =>
  path.join(dataRoot(), "intake", segment(workspaceId));

export { safeName };

function checkMeta(meta: IntakeMeta) {
  if (!meta || typeof meta !== "object") throw new IntakeError(400, "Bad meta");
  if (typeof meta.clientId !== "string" || !ID.test(meta.clientId))
    throw new IntakeError(400, "clientId must be a uuid");
  if (meta.kind !== "report" && meta.kind !== "share")
    throw new IntakeError(400, "kind must be report or share");
  if (meta.note !== undefined) {
    if (typeof meta.note !== "string") throw new IntakeError(400, "Bad note");
    if (meta.note.length > INTAKE_LIMITS.maxNoteChars)
      throw new IntakeError(413, "Note is too long");
  }
}

// An earlier request with this clientId, today or just before midnight.
function existing(
  workspaceId: string,
  clientId: string,
  now: number
): string | null {
  for (const t of [now, now - DAY]) {
    const dir = path.join(workspaceRoot(workspaceId), day(t), clientId);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function earlier(dir: string, clientId: string, workspaceId: string) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(dir, "result.json"), "utf8")
    ) as IntakeResult;
  } catch {
    // The first request is still delivering.
    return {
      id: clientId,
      sessionId: getOrchestrator(workspaceId)?.id ?? null,
      delivered: "queued",
      dir,
    } satisfies IntakeResult;
  }
}

// A big file is only ever named by its path: the agent opens it in parts.
const LARGE_BYTES = 1_000_000;

function fileNote(file: AcceptedFile): string {
  const large =
    file.data.length > LARGE_BYTES ? ", large: read it in parts" : "";
  const summary = file.summary
    ? `\n${file.summary.slice(0, 3000).replace(/^/gm, "  ")}`
    : "";
  return ` (${file.mediaType}, ${formatBytes(file.data.length)}${large})${summary}`;
}

/** Saves what a phone sent and hands it to the workspace's orchestrator. */
export async function receiveIntake(input: {
  workspaceId: string;
  deviceName: string;
  meta: IntakeMeta;
  files: IntakeFile[];
  now?: number;
}): Promise<IntakeResult & { duplicate: boolean }> {
  const { workspaceId, deviceName, meta, files } = input;
  const now = input.now ?? Date.now();
  if (!getWorkspace(workspaceId))
    throw new IntakeError(404, "Unknown workspace");
  checkMeta(meta);
  if (files.length > INTAKE_LIMITS.maxFiles)
    throw new IntakeError(413, "Too many files");
  const total = files.reduce((n, f) => n + f.data.length, 0);
  if (total > INTAKE_LIMITS.maxBytes) throw new IntakeError(413, "Too large");
  const logsAt = files.findIndex((f) => f.name === "logs.txt");
  const accepted: (AcceptedFile | null)[] = [];
  for (const [i, f] of files.entries()) {
    if (i === logsAt) {
      accepted.push(null);
      continue;
    }
    try {
      accepted.push(await acceptFile(f.name, f.data));
    } catch (e) {
      if (e instanceof RefusedFile) throw new IntakeError(e.status, e.message);
      throw e;
    }
  }

  const prior = existing(workspaceId, meta.clientId, now);
  if (prior)
    return { ...earlier(prior, meta.clientId, workspaceId), duplicate: true };

  const parent = path.join(workspaceRoot(workspaceId), day(now));
  const dir = path.join(parent, meta.clientId);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      return { ...earlier(dir, meta.clientId, workspaceId), duplicate: true };
    throw e;
  }

  try {
    const write = (name: string, data: string | Buffer) =>
      fs.writeFileSync(path.join(dir, name), data, { mode: 0o600 });
    write(
      "meta.json",
      JSON.stringify({ ...meta, deviceName, receivedAt: now }, null, 2)
    );
    if (meta.kind === "report")
      write("report.json", JSON.stringify(meta.report ?? {}, null, 2));
    const taken = new Set([
      "meta.json",
      "report.json",
      "logs.txt",
      "result.json",
    ]);
    let logs: string | undefined;
    const saved: { path: string; name: string; i: number }[] = [];
    const notes: Record<string, string> = {};
    files.forEach((f, i) => {
      const file = accepted[i];
      if (!file) {
        logs = f.data
          .toString("utf8")
          .split(/\r?\n/)
          .slice(-INTAKE_LIMITS.logMaxLines)
          .join("\n");
        write("logs.txt", logs);
        return;
      }
      const name = safeName(file.name, taken, i + 1);
      const full = path.join(dir, name);
      write(name, file.data);
      if (file.summary) write(path.basename(summaryPath(full)), file.summary);
      notes[full] = fileNote(file);
      saved.push({ path: full, name, i });
    });

    const images: ChatImage[] = saved
      .filter(
        (s) =>
          accepted[s.i]?.kind === "image" &&
          accepted[s.i]?.mediaType !== "image/heic" &&
          accepted[s.i]!.data.length <= MAX_INLINE_IMAGE_BYTES
      )
      .sort(
        (a, b) =>
          Number(/^screenshot/.test(b.name)) -
          Number(/^screenshot/.test(a.name))
      )
      .slice(0, INTAKE_LIMITS.maxInlineImages)
      .map((s) => ({
        mediaType: accepted[s.i]!.mediaType,
        data: accepted[s.i]!.data.toString("base64"),
      }));

    const { text, body } = buildIntakeMessage({
      meta,
      deviceName,
      dir,
      files: saved.map((s) => s.path),
      logs,
      notes,
    });
    const orchestrator = ensureOrchestrator(workspaceId);
    const state = chatState(orchestrator.id);
    const delivered =
      state === "running" || state === "waiting" ? "queued" : "sent";
    await sendChat(orchestrator.id, {
      id: `intake-${meta.clientId}`,
      text,
      images: images.length ? images : undefined,
      queue: true,
      origin: { kind: "device", label: deviceName, body },
    });
    const result: IntakeResult = {
      id: meta.clientId,
      sessionId: orchestrator.id,
      delivered,
      dir,
    };
    write("result.json", JSON.stringify(result));
    return { ...result, duplicate: false };
  } catch (e) {
    // So a retry can deliver it.
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/** The request's form, refused once its body passes `max` bytes. */
export async function cappedFormData(
  request: Request,
  max: number
): Promise<FormData> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max) throw new IntakeError(413, "Too large");
  if (!request.body) throw new IntakeError(400, "No body");
  let size = 0;
  const counted = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > max) controller.error(new IntakeError(413, "Too large"));
        else controller.enqueue(chunk);
      },
    })
  );
  try {
    return await new Response(counted, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch (e) {
    if (e instanceof IntakeError) throw e;
    throw new IntakeError(size > max ? 413 : 400, "Bad upload");
  }
}
