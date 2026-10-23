import { thisMachine } from "./identity";
import { machineCatalog } from "./catalog";
import type { MachineReport } from "./types";

/** What GET /api/machine answers: this machine's identity and agents. */
export async function thisMachineReport(): Promise<MachineReport> {
  return { identity: thisMachine(), catalog: await machineCatalog() };
}
