"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingToggle } from "@/components/Settings/SettingToggle";
import { useModelsQuery, useUpdateModels } from "@/data/models";
import type { ModelSettings } from "@/lib/models/config";
import {
  PROVIDER_PRESETS,
  type ModelPrice,
  type ModelProvider,
} from "@/lib/models/providers";
import { SubagentModels } from "./SubagentModels";
import { MODEL_ROLES, ROLE_LABELS } from "@/lib/models/roles";
import { ModelSelect } from "./ModelSelect";
import { ProviderCard } from "./ProviderCard";

const PRICE_FIELDS: { key: keyof ModelPrice; label: string }[] = [
  { key: "input", label: "Input" },
  { key: "cacheWrite", label: "Cache write" },
  { key: "cacheRead", label: "Cache read" },
  { key: "output", label: "Output" },
];

// Settings > Models: the model each kind of work runs on, the providers
// they can come from, and the prices usage is estimated at.
export function ModelsSection() {
  const { data, isPending, isError, error } = useModelsQuery();
  const update = useUpdateModels();
  if (isPending)
    return <div className="bg-muted/40 h-64 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;
  const { saved, effective, defaults } = data;
  const save = (patch: Partial<ModelSettings>) =>
    update.mutate({ ...saved, ...patch });

  const presetIds = new Set(PROVIDER_PRESETS.map((p) => p.id));
  const saveProvider = (p: ModelProvider) =>
    save({
      providers: [...(saved.providers ?? []).filter((x) => x.id !== p.id), p],
    });
  const addProvider = () => {
    const taken = new Set(effective.providers.map((p) => p.id));
    let n = 1;
    while (taken.has(`custom-${n}`)) n++;
    saveProvider({
      id: `custom-${n}`,
      label: `Custom ${n}`,
      api: "anthropic",
      authHeader: "bearer",
      models: [],
      enabled: false,
    });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-muted-foreground text-sm">
          Which model each kind of work runs on. A workspace can set its own
          (Settings › Workspaces), and a task its own when it starts or resumes.
        </p>
        <ul className="space-y-2">
          {MODEL_ROLES.map((role) => (
            <li
              key={role}
              className="bg-muted/40 space-y-1.5 rounded-lg px-3 py-2.5"
            >
              <label htmlFor={`role-${role}`} className="block">
                <span className="text-sm font-medium">
                  {ROLE_LABELS[role].label}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {ROLE_LABELS[role].hint}
                </span>
              </label>
              <ModelSelect
                id={`role-${role}`}
                value={saved.roles?.[role] ?? null}
                effective={effective}
                inheritLabel={`Default (${defaults[role].split("/").slice(1).join("/")})`}
                disabled={update.isPending}
                onChange={(ref) => {
                  const roles = { ...saved.roles };
                  if (ref) roles[role] = ref;
                  else delete roles[role];
                  save({ roles });
                }}
              />
            </li>
          ))}
        </ul>
        <SettingToggle
          title="Tasks plan first"
          detail="A chat task's first turn writes its plan to .agentos/plan.md on the planning model; the implementation model then follows it in the same conversation."
          checked={effective.planStep}
          onChange={(planStep) => save({ planStep })}
        />
      </section>

      <SubagentModels
        saved={saved.subagents}
        disabled={update.isPending}
        onChange={(subagents) => save({ subagents })}
      />

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Providers</h3>
        <p className="text-muted-foreground text-xs">
          Claude stays the default; another provider runs only where a role or a
          task picks it. Keys are never stored here: only where to read them
          from.
        </p>
        <ul className="space-y-2">
          {effective.providers.map((p) => (
            <ProviderCard
              key={`${p.id}-${JSON.stringify(p)}`}
              provider={p}
              saving={update.isPending}
              onSave={saveProvider}
              onRemove={
                presetIds.has(p.id)
                  ? undefined
                  : () =>
                      save({
                        providers: (saved.providers ?? []).filter(
                          (x) => x.id !== p.id
                        ),
                      })
              }
            />
          ))}
        </ul>
        <Button
          variant="outline"
          size="sm"
          className="h-11 md:h-8"
          onClick={addProvider}
          disabled={update.isPending}
        >
          Add provider
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Prices</h3>
        <p className="text-muted-foreground text-xs">
          Dollars per million tokens, for Usage&apos;s estimates. Claude&apos;s
          are API list prices: the plan itself is measured by its window.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 pr-2 font-normal">Model</th>
                {PRICE_FIELDS.map((f) => (
                  <th key={f.key} className="py-1 pr-2 font-normal">
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(effective.prices).map(([ref, price]) => (
                <tr key={ref} className="border-border border-t">
                  <td className="py-1 pr-2 font-mono">{ref}</td>
                  {PRICE_FIELDS.map((f) => (
                    <td key={f.key} className="py-1 pr-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.001"
                        defaultValue={price[f.key]}
                        aria-label={`${ref} ${f.label}`}
                        className="h-11 w-20 tabular-nums md:h-8"
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (
                            !Number.isFinite(v) ||
                            v < 0 ||
                            v === price[f.key]
                          )
                            return;
                          save({
                            prices: {
                              ...saved.prices,
                              [ref]: { ...price, [f.key]: v },
                            },
                          });
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {update.isError && (
        <p className="text-destructive text-sm">{update.error.message}</p>
      )}
    </div>
  );
}
