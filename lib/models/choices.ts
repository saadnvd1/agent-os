import type { EffectiveModels } from "./config";

// The "provider/model" refs a task can run on: every model of each enabled
// provider.
export function modelChoices(
  effective: Pick<EffectiveModels, "providers"> | undefined
) {
  return (effective?.providers ?? [])
    .filter((p) => p.enabled)
    .flatMap((p) =>
      p.models.map((m) => ({
        ref: `${p.id}/${m}`,
        label: m,
        provider: p.label,
      }))
    );
}
