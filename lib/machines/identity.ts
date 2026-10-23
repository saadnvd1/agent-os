/**
 * This machine as it names itself: the one name every surface shows (the
 * Machines dialog, the new-session chip, Work across machines), its OS and
 * the addresses another device could reach it at.
 */

import os from "os";
import { machineName } from "../claims/machine";
import { putSetting } from "../settings-store";
import { currentIdentity } from "../peer/keys";
import { lanAddresses, tailscaleAddresses } from "../security/net";

export interface MachineIdentity {
  name: string;
  hostname: string;
  os: string;
  arch: string;
  connectMachineId: string | null;
  addresses: string[];
}

const OS_LABEL: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

export const osLabel = (platform: string = os.platform()) =>
  OS_LABEL[platform] ?? platform;

export function thisMachine(): MachineIdentity {
  return {
    name: machineName(),
    hostname: os.hostname().split(".")[0] || "machine",
    os: osLabel(),
    arch: os.arch(),
    connectMachineId: currentIdentity()?.machineId ?? null,
    addresses: [...new Set([...tailscaleAddresses(), ...lanAddresses()])],
  };
}

/** A user-set name for this machine; the same one Work across machines shows. */
export function setThisMachineName(raw: string): string {
  const name = raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (!name) throw new Error("Name is required");
  putSetting("claims.machine_name", name);
  return name;
}
