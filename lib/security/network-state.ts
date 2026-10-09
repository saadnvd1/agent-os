import { tailscaleStatus, type TailscaleState } from "@/lib/tailscale";
import { networkSetting, networkSettingLocked } from "./network-settings";
import { reachableAt, type Reach } from "./reach";
import { connectStatus, type ConnectStatus } from "@/lib/connect/serve";

export interface NetworkState {
  lan: { on: boolean; locked: boolean };
  requirePairingOnTailnet: { on: boolean; locked: boolean };
  tailscale: TailscaleState;
  reach: Reach[];
  connect: ConnectStatus;
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
    connect: connectStatus(),
  };
}

// What a demo says about its network: nothing about the machine it runs on
// (no addresses, no tailnet, no Connect), whatever the machine has.
export function demoNetworkState(): NetworkState {
  return {
    lan: { on: false, locked: true },
    requirePairingOnTailnet: { on: false, locked: true },
    tailscale: { state: "missing" },
    reach: [],
    connect: { state: "off" },
  };
}
