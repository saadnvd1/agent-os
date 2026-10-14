import { NextRequest, NextResponse } from "next/server";
import { featuresNow } from "@/lib/config/client-config";
import { callingDevice, needsDevice } from "@/lib/security/device-me";
import { vocabFor } from "@/lib/voice/vocab";
import { getWorkspace } from "@/lib/workspaces";

// GET /api/voice/vocab?workspace=<id> - names to bias the phone's dictation.
export function GET(request: NextRequest) {
  if (!callingDevice(request)) return needsDevice();
  const id = request.nextUrl.searchParams.get("workspace");
  if (!id)
    return NextResponse.json(
      { error: "workspace is required" },
      { status: 400 }
    );
  if (!getWorkspace(id))
    return NextResponse.json({ error: "Unknown workspace" }, { status: 404 });
  if (!featuresNow().voice)
    return NextResponse.json({ error: "Voice is off" }, { status: 403 });
  return NextResponse.json(
    { phrases: vocabFor(id) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
