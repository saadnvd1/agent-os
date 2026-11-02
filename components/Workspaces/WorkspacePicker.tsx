"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Workspace } from "@/lib/db";

// Which workspace's settings the page shows.
export function WorkspacePicker({
  workspaces,
  value,
  onChange,
}: {
  workspaces: Workspace[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <label htmlFor="settings-workspace" className="text-sm font-medium">
        Workspace
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id="settings-workspace"
          className="h-11 min-w-0 flex-1 text-base sm:max-w-xs md:h-9 md:text-sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {workspaces.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
