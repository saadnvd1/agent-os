"use client";

import { Button } from "@/components/ui/button";
import { PriceInput } from "./PriceInput";
import { PickerSetting } from "@/components/Settings/PickerSetting";
import { ScrollTable } from "@/components/Settings/ListSection";
import { SettingSection } from "@/components/Settings/SettingRow";
import { SwitchSetting } from "@/components/Settings/settings-fields";
import { useModelsQuery, useUpdateModels } from "@/data/models";
import type { ModelSettings } from "@/lib/models/config";
import {
  PROVIDER_PRESETS,
  type ModelPrice,
  type ModelProvider,
} from "@/lib/models/providers";
import { SubagentModels } from "./SubagentModels";
import { INTERNAL_MODEL_ROLES } from "@/lib/models/agent-roles";
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
          Which model each kind of work runs on. Developer, Analyst, Reviewer
          and Supervisor are in Agent roles. A workspace can set its own
          (Settings › Workspaces), and a task its own when it starts or resumes.
        </p>
        <SettingSection>
          {INTERNAL_MODEL_ROLES(MODEL_ROLES).map((role) => (
            <PickerSetting<string | null>
              key={role}
              id={`role-${role}`}
              label={ROLE_LABELS[role].label}
              help={ROLE_LABELS[role].hint}
              value={saved.roles?.[role] ?? null}
              defaultValue={null}
              resetLabel="default"
              onSave={(ref) => {
                const roles = { ...saved.roles };
                if (ref) roles[role] = ref;
                else delete roles[role];
                return update.mutateAsync({ ...saved, roles });
              }}
              render={({ value, commit }) => (
                <ModelSelect
                  id={`role-${role}`}
                  value={value}
                  effective={effective}
                  inheritLabel="Default"
                  inheritDetail={defaults[role].split("/").slice(1).join("/")}
                  onChange={commit}
                />
              )}
            />
          ))}
          <SwitchSetting
            id="plan-step"
            label="Tasks plan first"
            help="A chat task's first turn writes its plan on the planning model; the implementation model then follows it in the same conversation."
            checked={effective.planStep}
            onSave={(planStep) => update.mutateAsync({ ...saved, planStep })}
          />
        </SettingSection>
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
        <ScrollTable>
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
                  <td className="py-1 pr-2 font-mono whitespace-nowrap">
                    {ref}
                  </td>
                  {PRICE_FIELDS.map((f) => (
                    <td key={f.key} className="py-1 pr-2">
                      <PriceInput
                        label={`${ref} ${f.label}`}
                        value={price[f.key]}
                        onSave={(v) =>
                          save({
                            prices: {
                              ...saved.prices,
                              [ref]: { ...price, [f.key]: v },
                            },
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      </section>
      {update.isError && (
        <p className="text-destructive text-sm">{update.error.message}</p>
      )}
    </div>
  );
}
