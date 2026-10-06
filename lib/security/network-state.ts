import { tailscaleStatus, type TailscaleState } from "@/lib/tailscale";
import { networkSetting, networkSettingLocked } from "./network-settings";
import { reachableAt, type Reach } from "./reach";

export interface NetworkState {
  lan: { on: boolean; locked: boolean };
  requirePairingOnTailnet: { on: boolean; locked: boolean };
  tailscale: TailscaleState;
  reach: Reach[];
}

export async function networkState(): Promise<NetworkState> {
  return {
    lan: { on: networkSetting("lan"), locked: networkSettingLocked("lan") },
    requirePairingOnTailnet: {
      on: networkSetting("require_pairing_on_tailnet"),
      locked: networkSettingLocked("require_pairing_on_tailnet"),
    },
    tailscale: await tailscaleStatus(),
    reach: await reachableAt(),
  };
}
