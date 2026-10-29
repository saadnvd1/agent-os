"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ArtifactVersion } from "@/lib/artifacts/actions";

const label = (v: ArtifactVersion, latest: boolean) =>
  `v${v.version}${latest ? " · latest" : ""}`;

export function VersionPicker({
  name,
  value,
  versions,
  onChange,
}: {
  name: string;
  value: string;
  versions: ArtifactVersion[];
  onChange: (id: string) => void;
}) {
  const last = versions[versions.length - 1];
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
        {name}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={`${name} version`} className="h-11 md:h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...versions].reverse().map((v) => (
            <SelectItem key={v.id} value={v.id} className="min-h-11 md:min-h-8">
              {label(v, v.id === last?.id)}
              {v.note ? ` · ${v.note}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
