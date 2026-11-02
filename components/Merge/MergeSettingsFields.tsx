"use client";

import { SelectSetting } from "@/components/Settings/settings-fields";
import { SettingSection } from "@/components/Settings/SettingRow";
import {
  MERGE_METHODS,
  METHOD_LABEL,
  REPO_SETTING,
  type MergeMethod,
  type MergePolicy,
  type MergeSettings,
  type MergeSource,
} from "@/lib/tasks/merge-methods";

const INHERIT = "inherit";

const SOURCE: Record<MergeSource, string> = {
  default: "default",
  global: "global setting",
  "agentos.json": "agentos.json",
  project: "this project",
};

const onOff = (on: boolean) => (on ? "On" : "Off");

const TOGGLE = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

/**
 * The merge method and the two deletions after a merge, each either set
 * here or left to what this level inherits (`inherited`, with where that
 * comes from). Each saves the moment it changes.
 */
export function MergeSettingsFields({
  idPrefix,
  settings,
  inherited,
  from,
  allowed,
  onSave,
}: {
  idPrefix: string;
  settings: MergeSettings;
  inherited: MergePolicy;
  from?: Record<keyof MergePolicy, MergeSource>;
  // The repository's allowed methods, when known.
  allowed?: MergeMethod[] | null;
  onSave: (settings: MergeSettings) => Promise<unknown>;
}) {
  const inheritOption = (key: keyof MergePolicy, shown: string) => ({
    value: INHERIT,
    label: from
      ? `Inherit: ${shown} (${SOURCE[from[key]]})`
      : `Default: ${shown}`,
  });
  const set = <K extends keyof MergeSettings>(
    key: K,
    value: MergeSettings[K] | undefined
  ) => onSave({ ...settings, [key]: value });
  const toggle = (key: "delete_remote_branch" | "delete_worktree") => (
    <SelectSetting
      id={`${idPrefix}-${key}`}
      label={
        key === "delete_remote_branch"
          ? "Delete the branch on origin after a merge"
          : "Delete the local worktree and branch after a merge"
      }
      help={
        key === "delete_remote_branch"
          ? "Never main, master, or a branch a stacked task still targets."
          : "Never one with uncommitted work or commits the merge didn't include."
      }
      value={
        settings[key] === undefined ? INHERIT : settings[key] ? "on" : "off"
      }
      options={[inheritOption(key, onOff(inherited[key])), ...TOGGLE]}
      defaultValue={INHERIT}
      hint=""
      onSave={(v) => set(key, v === INHERIT ? undefined : v === "on")}
    />
  );

  const method = settings.method ?? inherited.method;
  const refused = allowed && !allowed.includes(method);

  return (
    <SettingSection>
      <SelectSetting
        id={`${idPrefix}-method`}
        label="Merge method"
        help="How sign-off, Done, Land and external PRs merge. If GitHub refuses it, the merge fails and says so; it never falls back to another method."
        value={settings.method ?? INHERIT}
        options={[
          inheritOption("method", METHOD_LABEL[inherited.method]),
          ...MERGE_METHODS.map((m) => ({
            value: m,
            label:
              METHOD_LABEL[m] +
              (allowed && !allowed.includes(m) ? " (off on GitHub)" : ""),
          })),
        ]}
        defaultValue={INHERIT}
        hint=""
        onSave={(v) =>
          set("method", v === INHERIT ? undefined : (v as MergeMethod))
        }
      />
      {refused && (
        <p className="text-destructive px-3 py-2 text-xs">
          This repository has &ldquo;{REPO_SETTING[method]}&rdquo; turned off on
          GitHub, so merges will be refused until it&rsquo;s on or the method
          changes.
        </p>
      )}
      {toggle("delete_remote_branch")}
      {toggle("delete_worktree")}
    </SettingSection>
  );
}
