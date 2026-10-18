"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProjectTier } from "@/lib/project-tier/types";

const DETAIL: Record<ProjectTier, string> = {
  production: "CI, the independent review and scope must pass before a merge.",
  fast: "A task's PR merges as soon as it opens: no CI wait, no review.",
};

export function ProjectTierField({
  value,
  onChange,
}: {
  value: ProjectTier;
  onChange: (tier: ProjectTier) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Tier</label>
      <Select value={value} onValueChange={(v) => onChange(v as ProjectTier)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fast">Fast</SelectItem>
          <SelectItem value="production">Production</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">{DETAIL[value]}</p>
    </div>
  );
}
