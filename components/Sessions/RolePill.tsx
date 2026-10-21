"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AvailabilityDot,
  LocalityBadge,
} from "@/components/Models/ModelBadges";
import { RoleModelSelect } from "@/components/Models/RoleModelSelect";
import { useCrewQuery, useSwitchSessionModel } from "@/data/models";
import { useLaunchSession } from "@/data/sessions";
import { usePanes } from "@/contexts/PaneContext";
import { analystUiActions } from "@/stores/analystUi";
import type { Session } from "@/lib/db";
import {
  AGENT_ROLES,
  AGENT_ROLE_DEFS,
  isAgentRole,
} from "@/lib/models/agent-roles";
import { cn } from "@/lib/utils";
import { uuid } from "@/lib/uuid";

const modelName = (ref: string | null) =>
  ref ? ref.split("/").slice(1).join("/") : "model";

// The role a running session was started in and the model it runs on, with
// its crew: the sessions it works with, by @name. Nothing for a session
// started without a role. `compact` is a phone's small button.
export function RolePill({
  session,
  paneId,
  compact,
}: {
  session: Session | null | undefined;
  paneId?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const role = isAgentRole(session?.agent_role) ? session.agent_role : null;
  const crew = useCrewQuery(session?.id, !!role);
  const switchModel = useSwitchSessionModel(session?.id ?? "");
  const launch = useLaunchSession();
  const { attachSession } = usePanes();
  if (!session || !role) return null;
  const me = crew.data?.members.find((m) => m.id === session.id);
  const down = me?.availability === "down";
  const label = AGENT_ROLE_DEFS[role].label;
  const others = crew.data?.members.filter((m) => m.id !== session.id) ?? [];

  const add = async (next: (typeof AGENT_ROLES)[number]) => {
    // A chat's analyst is paired with it, to review each turn.
    if (next === "analyst" && session.view === "chat") {
      setOpen(false);
      analystUiActions.open(session.id, session.name, paneId ?? null);
      return;
    }
    try {
      const { session: made } = await launch.mutateAsync({
        id: uuid(),
        projectId: session.project_id,
        agentType: "claude",
        model: "",
        access: "full",
        useWorktree: false,
        baseBranch: null,
        prompt: "",
        agentRole: next,
        crewId: session.crew_id ?? session.id,
      });
      if (paneId) attachSession(paneId, made.id, made.tmux_name ?? "");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`${label}, ${modelName(me?.ref ?? null)}${down ? ", model not answering" : ""}`}
        className={cn(
          "ring-border/70 flex shrink-0 items-center gap-1.5 rounded-full text-xs ring-1 ring-inset",
          down
            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
            : "bg-muted/60",
          compact
            ? "-my-1.5 h-11 w-11 justify-center rounded-lg ring-0"
            : "h-7 max-w-64 px-2.5"
        )}
      >
        <span className="bg-accent text-primary grid h-4 w-4 shrink-0 place-items-center rounded text-[10px] font-semibold">
          {label[0]}
        </span>
        {!compact && (
          <>
            <span className="truncate">
              {label}
              {me?.ref ? ` · ${modelName(me.ref)}` : ""}
            </span>
            {me && !down && <LocalityBadge locality={me.locality} />}
            {down && <span className="shrink-0">unreachable</span>}
          </>
        )}
        {compact && down && (
          <span className="bg-destructive absolute h-2 w-2 translate-x-3 -translate-y-3 rounded-full" />
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label} · role and crew</DialogTitle>
            <DialogDescription>
              {AGENT_ROLE_DEFS[role].purpose}
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/40 space-y-2 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <AvailabilityDot
                  availability={{ state: me?.availability ?? "unknown" }}
                />
                <span className="truncate">{modelName(me?.ref ?? null)}</span>
              </span>
              {me && <LocalityBadge locality={me.locality} />}
            </div>
            {down && (
              <p role="alert" className="text-destructive text-xs">
                This model&apos;s server isn&apos;t answering. Your conversation
                is kept: switch to another model to carry on.
              </p>
            )}
            <RoleModelSelect
              value={me?.ref ?? null}
              inheritLabel="Switch model…"
              disabled={switchModel.isPending}
              onChange={(ref) =>
                ref &&
                switchModel.mutate(ref, {
                  onError: (e) => toast.error(e.message),
                  onSuccess: () => toast.success("Switched model"),
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-muted-foreground text-xs font-medium uppercase">
              Crew
            </h3>
            {others.length === 0 && (
              <p className="text-muted-foreground text-sm">
                Nobody else yet. Add a role to work with this session.
              </p>
            )}
            {others.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{m.name}</span>
                  <span className="text-muted-foreground block truncate font-mono text-xs">
                    {m.agentRole ? `@${m.agentRole}` : "no role"} ·{" "}
                    {modelName(m.ref)}
                  </span>
                </span>
                <AvailabilityDot availability={{ state: m.availability }} />
                <LocalityBadge locality={m.locality} />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {AGENT_ROLES.filter(
              (r) =>
                r !== role &&
                r !== "supervisor" &&
                !others.some((m) => m.agentRole === r)
            ).map((r) => (
              <Button
                key={r}
                variant="outline"
                className="h-11 md:h-9"
                disabled={launch.isPending}
                onClick={() => void add(r)}
              >
                Add {AGENT_ROLE_DEFS[r].label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
