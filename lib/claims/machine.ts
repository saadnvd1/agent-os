import { randomUUID } from "crypto";
import os from "os";
import { getSetting, putSetting } from "../settings-store";

const ID_KEY = "claims.machine_id";

export function machineId(): string {
  const have = getSetting(ID_KEY);
  if (have) return have;
  const id = randomUUID();
  putSetting(ID_KEY, id);
  return id;
}

export function machineName(): string {
  const set = getSetting("claims.machine_name")?.trim();
  return (set || os.hostname().split(".")[0] || "machine").slice(0, 60);
}

// Off: this machine neither sends nor takes claims.
export const claimsShared = () => getSetting("claims.share") !== "off";
