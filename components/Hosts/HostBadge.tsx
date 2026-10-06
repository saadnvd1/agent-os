"use client";

import { Server } from "lucide-react";
import { useHostNames } from "@/data/hosts";
import { cn } from "@/lib/utils";

// Shown only for other machines; local is the default and stays unlabeled.
export function HostBadge({
  hostId,
  className,
}: {
  hostId: string | null | undefined;
  className?: string;
}) {
  const names = useHostNames();
  if (!hostId || hostId === "local") return null;
  return (
    <span
      className={cn(
        "bg-primary/10 text-primary inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
        className
      )}
    >
      <Server className="h-2.5 w-2.5" />
      {names[hostId] || "remote"}
    </span>
  );
}
