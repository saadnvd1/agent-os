"use client";

import { LayoutGrid } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspacesQuery } from "@/data/workspaces";

const NONE = "none";

// "Adds to Internal Tools", changeable to another workspace or none.
export function WorkspacePick({
  workspaceId,
  onChange,
}: {
  workspaceId: string | null;
  onChange: (workspaceId: string | null) => void;
}) {
  const { data: workspaces = [] } = useWorkspacesQuery();
  if (workspaces.length === 0) return null;
  // One deleted since the dialog opened reads as none.
  const value = workspaces.some((w) => w.id === workspaceId)
    ? (workspaceId as string)
    : NONE;
  return (
    <div className="flex items-center gap-2 text-sm">
      <LayoutGrid className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      <span className="text-muted-foreground shrink-0">Adds to</span>
      <Select
        value={value}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
      >
        <SelectTrigger
          aria-label="Workspace"
          className="h-11 min-w-0 flex-1 md:h-9"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE} className="min-h-11 md:min-h-0">
            No workspace
          </SelectItem>
          {workspaces.map((w) => (
            <SelectItem key={w.id} value={w.id} className="min-h-11 md:min-h-0">
              {w.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
