import { NextRequest, NextResponse } from "next/server";
import { listDevices } from "@/lib/security/devices";
import { DEVICE_HEADER, TRUST_HEADER } from "@/lib/security/auth";
import { demoMode } from "@/lib/security/demo";

// GET /api/devices - paired devices, and how this request was trusted
export async function GET(request: NextRequest) {
  return NextResponse.json({
    // A demo's visitors are strangers: no one's address or browser.
    devices: demoMode()
      ? listDevices().map(({ last_address: _a, user_agent: _u, ...d }) => d)
      : listDevices(),
    current: {
      deviceId: request.headers.get(DEVICE_HEADER),
      via: request.headers.get(TRUST_HEADER),
    },
  });
}
