import { NextRequest, NextResponse } from "next/server";
import { demoNetworkState, networkState } from "@/lib/security/network-state";
import { demoMode } from "@/lib/security/demo";
import { requireLocalTrust } from "@/lib/security/route-guard";
import { setConnectEnabled } from "@/lib/connect/config";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import {
  mergeApprovalsOn,
  setMergeApprovals,
} from "@/lib/orchestrator/merge-approvals";
import { APPROVALS_OFF_PRESENCE } from "@/lib/orchestrator/presence-binding";
import { relyingParty, verifyPresence } from "@/lib/security/presence";
import { refusalResponse } from "@/lib/security/presence-http";
import {
  setNetworkSetting,
  networkSettingLocked,
  type NetworkSetting,
} from "@/lib/security/network-settings";

// GET /api/devices/network - Wi-Fi access, tailnet pairing, Tailscale, addresses
export async function GET() {
  return NextResponse.json(
    demoMode() ? demoNetworkState() : await networkState()
  );
}

// PUT /api/devices/network {lan?, requirePairingOnTailnet?, connect?, mergeApprovals?}
export async function PUT(request: NextRequest) {
  const refused = requireLocalTrust(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => ({}))) as {
    lan?: boolean;
    requirePairingOnTailnet?: boolean;
    connect?: boolean;
    mergeApprovals?: boolean;
    assertion?: AuthenticationResponseJSON;
  };
  // Switching Saad's merge approvals off lets sensitive PRs merge without
  // him, so it needs his passkey: anything on this machine could ask.
  if (body.mergeApprovals === false && mergeApprovalsOn()) {
    try {
      await verifyPresence(
        relyingParty(request.headers),
        body.assertion,
        "approvals-off",
        APPROVALS_OFF_PRESENCE
      );
    } catch (error) {
      return refusalResponse(error);
    }
  }
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
  if (typeof body.mergeApprovals === "boolean")
    setMergeApprovals(body.mergeApprovals);
  return NextResponse.json(await networkState());
}
