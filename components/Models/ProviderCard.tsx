"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTestProvider } from "@/data/models";
import {
  describeSecretRef,
  type ModelProvider,
  type SecretRef,
} from "@/lib/models/providers";
import { ANTHROPIC } from "@/lib/models/roles";
import { cn } from "@/lib/utils";

const KINDS: {
  value: SecretRef["kind"];
  label: string;
  a: string;
  b?: string;
}[] = [
  { value: "tokenvault", label: "tokenvault", a: "Project", b: "Description" },
  { value: "keychain", label: "macOS Keychain", a: "Service", b: "Account" },
  { value: "env", label: "Environment variable", a: "Variable (…_API_KEY)" },
];

function refFields(ref: SecretRef | undefined): [string, string] {
  if (!ref) return ["", ""];
  if (ref.kind === "tokenvault") return [ref.project, ref.desc ?? ""];
  if (ref.kind === "keychain") return [ref.service, ref.account ?? ""];
  return [ref.name, ""];
}

function toRef(
  kind: SecretRef["kind"],
  a: string,
  b: string
): SecretRef | undefined {
  const x = a.trim();
  const y = b.trim() || undefined;
  if (!x) return undefined;
  if (kind === "tokenvault") return { kind, project: x, desc: y };
  if (kind === "keychain") return { kind, service: x, account: y };
  return { kind, name: x };
}

const list = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

// One provider: on or off, its endpoint, where its key lives (never the
// key), its models and Claude Code's tiers mapped onto them, and a test.
export function ProviderCard({
  provider,
  saving,
  onSave,
  onRemove,
}: {
  provider: ModelProvider;
  saving: boolean;
  onSave: (p: ModelProvider) => void;
  onRemove?: () => void;
}) {
  const builtIn = provider.id === ANTHROPIC;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SecretRef["kind"]>(
    provider.auth?.kind ?? "env"
  );
  const [a0, b0] = refFields(provider.auth);
  const [a, setA] = useState(a0);
  const [b, setB] = useState(b0);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [models, setModels] = useState(provider.models.join(", "));
  const [tiers, setTiers] = useState(provider.tiers ?? {});
  const test = useTestProvider();
  const kindInfo = KINDS.find((k) => k.value === kind)!;
  const ready = builtIn || (!!provider.baseUrl && !!provider.auth);

  const draft = (): ModelProvider => ({
    ...provider,
    baseUrl: baseUrl.trim() || undefined,
    auth: toRef(kind, a, b),
    models: list(models),
    tiers: Object.fromEntries(
      Object.entries(tiers).filter(([, v]) => v)
    ) as ModelProvider["tiers"],
  });

  return (
    <li className="bg-muted/40 space-y-3 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{provider.label}</p>
          <p className="text-muted-foreground truncate text-xs">
            {builtIn
              ? "Your Claude login; no key"
              : `${provider.baseUrl ?? "no base URL"} · key: ${describeSecretRef(provider.auth)}`}
          </p>
        </div>
        {!builtIn && (
          <Switch
            checked={provider.enabled}
            disabled={saving || (!ready && !provider.enabled)}
            title={ready ? undefined : "Set its base URL and key first"}
            onCheckedChange={(enabled) => onSave({ ...provider, enabled })}
            aria-label={`Use ${provider.label}`}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-11 md:h-8"
          disabled={test.isPending}
          onClick={() => test.mutate({ provider: provider.id })}
        >
          {test.isPending ? "Testing…" : "Test provider"}
        </Button>
        {!builtIn && (
          <Button
            variant="ghost"
            size="sm"
            className="h-11 md:h-8"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? "Close" : "Edit"}
          </Button>
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive h-11 md:h-8"
            onClick={onRemove}
          >
            Remove
          </Button>
        )}
      </div>
      {test.data && (
        <p
          className={cn(
            "text-xs",
            test.data.ok
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-destructive"
          )}
        >
          {test.data.ok ? "Works: " : "Failed: "}
          {test.data.message} ({Math.round(test.data.ms)} ms)
        </p>
      )}
      {test.isError && (
        <p className="text-destructive text-xs">{test.error.message}</p>
      )}
      {open && !builtIn && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft());
          }}
        >
          <Field label="Base URL">
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://…/anthropic"
              className="h-11 md:h-9"
            />
          </Field>
          <Field label="Key from">
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as SecretRef["kind"])}
            >
              <SelectTrigger className="h-11 md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={kindInfo.a}>
              <Input
                value={a}
                onChange={(e) => setA(e.target.value)}
                className="h-11 md:h-9"
                autoComplete="off"
              />
            </Field>
            {kindInfo.b && (
              <Field label={`${kindInfo.b} (optional)`}>
                <Input
                  value={b}
                  onChange={(e) => setB(e.target.value)}
                  className="h-11 md:h-9"
                  autoComplete="off"
                />
              </Field>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            Where the key lives, not the key: it&apos;s fetched when an agent
            starts and goes only into that agent&apos;s environment.
          </p>
          <Field label="Models (comma-separated)">
            <Input
              value={models}
              onChange={(e) => setModels(e.target.value)}
              className="h-11 md:h-9"
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            {(["opus", "sonnet", "haiku"] as const).map((t) => (
              <Field key={t} label={`${t} tier`}>
                <Input
                  value={tiers[t] ?? ""}
                  onChange={(e) =>
                    setTiers((x) => ({ ...x, [t]: e.target.value.trim() }))
                  }
                  className="h-11 md:h-9"
                />
              </Field>
            ))}
          </div>
          <Button
            type="submit"
            size="sm"
            className="h-11 md:h-8"
            disabled={saving}
          >
            Save
          </Button>
        </form>
      )}
    </li>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      {children}
    </label>
  );
}
