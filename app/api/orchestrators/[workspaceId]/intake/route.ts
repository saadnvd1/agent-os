import { NextRequest, NextResponse } from "next/server";
import { featuresNow } from "@/lib/config/client-config";
import { getDevice } from "@/lib/security/devices";
import { callingDevice, needsDevice } from "@/lib/security/device-me";
import { getWorkspace } from "@/lib/workspaces";
import {
  cappedFormData,
  IntakeError,
  receiveIntake,
  type IntakeFile,
} from "@/lib/intake/intake";
import {
  BODY_SLACK_BYTES,
  INTAKE_LIMITS,
  MAX_META_BYTES,
  takeIntakeSlot,
} from "@/lib/intake/limits";
import type { IntakeMeta } from "@/lib/intake/message";

const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status });

// POST /api/orchestrators/:workspaceId/intake - a shake report or a share
// from the phone, delivered to the workspace's orchestrator.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const deviceId = callingDevice(request);
  if (!deviceId) return needsDevice();
  const { workspaceId } = await params;
  if (!getWorkspace(workspaceId)) return fail(404, "Unknown workspace");
  const features = featuresNow();
  if (!features.shakeToReport && !features.shareIntake)
    return fail(403, "Intake is off");
  if (!takeIntakeSlot(deviceId)) return fail(429, "Too many requests");
  try {
    const form = await cappedFormData(
      request,
      INTAKE_LIMITS.maxBytes + BODY_SLACK_BYTES
    );
    const raw = form.get("meta");
    const metaText =
      typeof raw === "string" ? raw : raw ? await (raw as Blob).text() : "";
    if (!metaText || Buffer.byteLength(metaText) > MAX_META_BYTES)
      return fail(metaText ? 413 : 400, "meta is missing or too large");
    let meta: IntakeMeta;
    try {
      meta = JSON.parse(metaText);
    } catch {
      return fail(400, "meta isn't JSON");
    }
    const files: IntakeFile[] = [];
    for (const part of form.getAll("file")) {
      if (typeof part === "string") continue;
      files.push({
        name: (part as File).name || "file",
        data: Buffer.from(await part.arrayBuffer()),
      });
    }
    const { duplicate, ...result } = await receiveIntake({
      workspaceId,
      deviceName: getDevice(deviceId)?.name ?? "Phone",
      meta,
      files,
    });
    return NextResponse.json(result, { status: duplicate ? 200 : 201 });
  } catch (e) {
    if (e instanceof IntakeError) return fail(e.status, e.message);
    console.error("Intake failed:", e);
    return fail(500, "Couldn't deliver it");
  }
}
