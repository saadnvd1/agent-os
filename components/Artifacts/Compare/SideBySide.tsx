"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { ArtifactFrame } from "@/components/Chat/ArtifactFrame";
import type { ArtifactVersion } from "@/lib/artifacts/actions";
import { cn } from "@/lib/utils";

// Two versions in the viewer's sandboxed frames: next to each other when
// there's room, otherwise one at a time with a toggle.
export function SideBySide({
  from,
  to,
}: {
  from: ArtifactVersion;
  to: ArtifactVersion;
}) {
  const [side, setSide] = useState<"from" | "to">("to");
  const panes = [
    { key: "from", v: from },
    { key: "to", v: to },
  ] as const;
  return (
    <div className="flex h-full min-h-[60dvh] flex-col gap-2 p-2 @2xl:p-3">
      <div className="@2xl:hidden">
        <Segmented
          label="Version shown"
          value={side}
          onChange={setSide}
          options={panes.map((p) => ({
            value: p.key,
            label: `v${p.v.version}${p.key === "from" ? " (before)" : " (after)"}`,
          }))}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-3 @2xl:grid-cols-2">
        {panes.map(({ key, v }) => (
          <div
            key={key}
            className={cn(
              "min-h-0 flex-col gap-1",
              side === key ? "flex" : "hidden @2xl:flex"
            )}
          >
            <div className="text-muted-foreground hidden px-1 text-xs @2xl:block">
              v{v.version}
              {key === "from" ? " · before" : " · after"}
            </div>
            <ArtifactFrame
              artifactId={v.id}
              title={`${v.title} v${v.version}`}
              fill
              className="bg-background min-h-[50dvh] rounded-lg shadow-sm"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
