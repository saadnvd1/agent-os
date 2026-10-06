import { NextRequest, NextResponse } from "next/server";
import { listDevices } from "@/lib/security/devices";
import { DEVICE_HEADER, TRUST_HEADER } from "@/lib/security/auth";

// GET /api/devices - paired devices, and how this request was trusted
export async function GET(request: NextRequest) {
  return NextResponse.json({
    devices: listDevices(),
    current: {
      deviceId: request.headers.get(DEVICE_HEADER),
      via: request.headers.get(TRUST_HEADER),
    },
  });
}
