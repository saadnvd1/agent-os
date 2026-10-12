import { NextRequest, NextResponse } from "next/server";
import { sendTestPush } from "@/lib/notify/push";
import { listPushDevices } from "@/lib/security/devices";
import { readCapped } from "@/lib/security/read-capped";

// POST /api/push/test { deviceId? } - a real push to the registered phones
// now, ignoring the quiet rules, and what the relay said about each.
export async function POST(request: NextRequest) {
  let deviceId: string | undefined;
  try {
    const text = await readCapped(request, 1024);
    if (text === null)
      return NextResponse.json({ error: "Too large" }, { status: 413 });
    const v = JSON.parse(text || "{}");
    if (typeof v?.deviceId === "string") deviceId = v.deviceId;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const devices = listPushDevices().filter(
    (d) => !deviceId || d.id === deviceId
  );
  if (!devices.length)
    return NextResponse.json(
      {
        error: deviceId
          ? "That device has no push registered"
          : "No phone has push registered yet",
      },
      { status: deviceId ? 404 : 409 }
    );
  const { results, unavailable } = await sendTestPush(deviceId);
  if (unavailable && !results.length)
    return NextResponse.json(
      { error: `Push isn't available: ${unavailable}` },
      { status: 409 }
    );
  return NextResponse.json({ results, unavailable });
}
