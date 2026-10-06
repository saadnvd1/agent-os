import { NextRequest, NextResponse } from "next/server";
import { networkState } from "@/lib/security/network-state";
import { requireLocalTrust } from "@/lib/security/route-guard";
import { setConnectEnabled } from "@/lib/connect/config";
import {
  setNetworkSetting,
  networkSettingLocked,
  type NetworkSetting,
} from "@/lib/security/network-settings";

// GET /api/devices/network - Wi-Fi access, tailnet pairing, Tailscale, addresses
export async function GET() {
  return NextResponse.json(await networkState());
}

// PUT /api/devices/network {lan?, requirePairingOnTailnet?}
export async function PUT(request: NextRequest) {
  const refused = requireLocalTrust(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => ({}))) as {
    lan?: boolean;
    requirePairingOnTailnet?: boolean;
    connect?: boolean;
  };
  if (body.connect !== undefined && !setConnectEnabled(body.connect)) {
    return NextResponse.json(
      { error: "This machine isn't enrolled. Run agent-os connect first." },
      { status: 409 }
    );
  }
  const changes: [NetworkSetting, boolean | undefined][] = [
    ["lan", body.lan],
    ["require_pairing_on_tailnet", body.requirePairingOnTailnet],
  ];
  for (const [key, value] of changes) {
    if (value === undefined) continue;
    if (networkSettingLocked(key)) {
      return NextResponse.json(
        { error: `${key} is set by an environment variable` },
        { status: 409 }
      );
    }
    setNetworkSetting(key, value);
  }
  return NextResponse.json(await networkState());
}
