"use client";

import { useEffect } from "react";
import { useSnapshot } from "valtio";
import { Check, ChevronDown, Monitor } from "lucide-react";
import * as DM from "@/components/ui/dropdown-menu";
import { useHostsQuery } from "@/data/hosts";
import { useBrowserMachine } from "@/data/machines";
import { machineLabel } from "@/lib/machines/label";
import { machinesUi, machinesUiActions } from "@/stores/machines";
import { cn } from "@/lib/utils";

// A quick way between the machines linked here: narrows the sidebar to one
// machine's sessions and starts new chats there. Hidden until one is linked.
export function MachineSwitcher() {
  const { data: hosts = [], isSuccess } = useHostsQuery();
  const { scopeHostId } = useSnapshot(machinesUi);
  const browser = useBrowserMachine();
  const machines = hosts.filter((h) => h.id === "local" || h.linked);
  const current = machines.find((h) => h.id === scopeHostId) ?? null;

  // A machine that was unlinked since goes back to all of them.
  useEffect(() => {
    if (isSuccess && scopeHostId && !current) machinesUiActions.setScope(null);
  }, [isSuccess, scopeHostId, current]);

  if (machines.length < 2) return null;
  return (
    <DM.DropdownMenu>
      <DM.DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Machine: ${current ? machineLabel(current) : "All machines"}`}
          className={cn(
            "border-border/70 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] flex h-11 max-w-full min-w-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs md:h-8",
            current && "border-primary/40 bg-primary/10 text-primary"
          )}
        >
          <Monitor className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {current ? machineLabel(current) : "All machines"}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </DM.DropdownMenuTrigger>
      <DM.DropdownMenuContent align="start" className="max-w-80">
        <DM.DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Machine
        </DM.DropdownMenuLabel>
        {[null, ...machines].map((h) => (
          <DM.DropdownMenuItem
            key={h?.id ?? "all"}
            className="min-h-11 md:min-h-8"
            onClick={() => machinesUiActions.setScope(h?.id ?? null)}
          >
            <span className="flex-1 truncate">
              {h ? machineLabel(h, browser.hostId) : "All machines"}
            </span>
            {(current?.id ?? null) === (h?.id ?? null) && (
              <Check className="text-primary h-3.5 w-3.5" />
            )}
          </DM.DropdownMenuItem>
        ))}
      </DM.DropdownMenuContent>
    </DM.DropdownMenu>
  );
}
