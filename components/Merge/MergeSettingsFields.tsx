"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

function Field({
  label,
  detail,
  value,
  inheritLabel,
  options,
  onChange,
  disabled,
}: {
  label: string;
  detail: string;
  value: string;
  inheritLabel: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-11 md:h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">{detail}</p>
    </div>
  );
}

const TOGGLE = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

/**
 * The merge method and the two deletions after a merge, each either set
 * here or left to what this level inherits (`inherited`, with where that
 * comes from).
 */
export function MergeSettingsFields({
  settings,
  inherited,
  from,
  allowed,
  disabled,
  onChange,
}: {
  settings: MergeSettings;
  inherited: MergePolicy;
  from?: Record<keyof MergePolicy, MergeSource>;
  // The repository's allowed methods, when known.
  allowed?: MergeMethod[] | null;
  disabled?: boolean;
  onChange: (settings: MergeSettings) => void;
}) {
  const inheritLabel = (key: keyof MergePolicy, shown: string) =>
    from ? `Inherit: ${shown} (${SOURCE[from[key]]})` : `Default: ${shown}`;
  const set = <K extends keyof MergeSettings>(
    key: K,
    value: MergeSettings[K] | undefined
  ) => onChange({ ...settings, [key]: value });
  const toggle = (key: "delete_remote_branch" | "delete_worktree") => (
    <Field
      label={
        key === "delete_remote_branch"
          ? "Delete the branch on origin after a merge"
          : "Delete the local worktree and branch after a merge"
      }
      detail={
        key === "delete_remote_branch"
          ? "Never main, master, or a branch a stacked task still targets."
          : "Never one with uncommitted work or commits the merge didn't include."
      }
      value={
        settings[key] === undefined ? INHERIT : settings[key] ? "on" : "off"
      }
      inheritLabel={inheritLabel(key, onOff(inherited[key]))}
      options={TOGGLE}
      disabled={disabled}
      onChange={(v) => set(key, v === INHERIT ? undefined : v === "on")}
    />
  );

  const method = settings.method ?? inherited.method;
  const refused = allowed && !allowed.includes(method);

  return (
    <div className="space-y-3">
      <Field
        label="Merge method"
        detail="How sign-off, Done, Land and external PRs merge. If GitHub refuses it, the merge fails and says so; it never falls back to another method."
        value={settings.method ?? INHERIT}
        inheritLabel={inheritLabel("method", METHOD_LABEL[inherited.method])}
        options={MERGE_METHODS.map((m) => ({
          value: m,
          label:
            METHOD_LABEL[m] +
            (allowed && !allowed.includes(m) ? " (off on GitHub)" : ""),
        }))}
        disabled={disabled}
        onChange={(v) =>
          set("method", v === INHERIT ? undefined : (v as MergeMethod))
        }
      />
      {refused && (
        <p className="text-destructive text-xs">
          This repository has &ldquo;{REPO_SETTING[method]}&rdquo; turned off on
          GitHub, so merges will be refused until it&rsquo;s on or the method
          changes.
        </p>
      )}
      {toggle("delete_remote_branch")}
      {toggle("delete_worktree")}
    </div>
  );
}
