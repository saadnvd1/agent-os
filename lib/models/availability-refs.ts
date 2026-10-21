import { modelCatalog } from "./catalog";
import { modelAvailability as probeRef } from "./catalog";
import type { Availability } from "./availability";

// Every local model's availability by ref, probing the stale or all of them.
export async function modelAvailability(
  refresh = false
): Promise<Record<string, Availability>> {
  const local = modelCatalog().filter((c) => c.locality === "local");
  const out: Record<string, Availability> = {};
  await Promise.all(
    local.map(async (c) => {
      out[c.ref] = await probeRef(c.ref, undefined, refresh);
    })
  );
  return out;
}
