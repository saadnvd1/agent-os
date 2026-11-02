"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  ASheet,
  ASheetContent,
  ASheetDescription,
  ASheetHeader,
  ASheetTitle,
} from "@/components/a/ASheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ShimmeringLoader } from "@/components/ui/skeleton";
import { useAddLeads, useLeadSetup } from "@/data/leads";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { leadsUi, leadsUiActions } from "@/stores/leadsUi";
import { settingsUiActions } from "@/stores/settingsUi";
import { sidebarUiActions } from "@/stores/sidebarUi";
import {
  addLabel,
  addPlan,
  NEW_CHAT,
  type LeadPick,
} from "@/lib/leads/add-plan";
import { kindFromName } from "@/lib/leads/order";
import { TECH } from "@/lib/leads/types";
import type { LeadSetupView } from "@/lib/leads/setup";
import { LeadOption, StartAs } from "./LeadOption";

// The phone gets a bottom sheet, a wider screen one on the right.
export function LeadsSheetFrame({
  open,
  title,
  description,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const wide = useMediaQuery("(min-width: 768px)");
  return (
    <ASheet open={open} onOpenChange={(o) => !o && leadsUiActions.close()}>
      <ASheetContent
        side={wide ? "right" : "bottom"}
        className={wide ? "w-full max-w-md" : "max-h-[90dvh] rounded-t-2xl"}
      >
        <ASheetHeader className="pr-12">
          <ASheetTitle>{title}</ASheetTitle>
          <ASheetDescription>{description}</ASheetDescription>
        </ASheetHeader>
        {children}
      </ASheetContent>
    </ASheet>
  );
}

// Workspace menu → Add leads: the workspace's chief and Tech lead (its
// orchestrator, in place) plus the leads ticked, each a new chat or an
// adopted one. Run again, it adds only what's missing.
export function AddLeadsSheet() {
  const { add } = useSnapshot(leadsUi);
  const { data: setup } = useLeadSetup(add?.workspaceId ?? null);
  return (
    <LeadsSheetFrame
      open={!!add}
      title={setup ? `Add leads · ${setup.workspace}` : "Add leads"}
      description="Each lead is a chat that heads one part of this workspace and keeps your pinned direction. The workspace also gets a chief of staff, which acts only when you ask."
    >
      {add && !setup && <SheetSkeleton />}
      {add && setup && (
        <AddLeadsForm key={add.workspaceId} setup={setup} initial={add.kind} />
      )}
    </LeadsSheetFrame>
  );
}

export function SheetSkeleton() {
  return (
    <div className="space-y-2 px-4 pb-6">
      {[0, 1, 2, 3].map((i) => (
        <ShimmeringLoader
          key={i}
          delayIndex={i}
          className="h-14 w-full rounded-lg"
        />
      ))}
    </div>
  );
}

function AddLeadsForm({
  setup,
  initial,
}: {
  setup: LeadSetupView;
  initial: string | null;
}) {
  const [picks, setPicks] = useState<Record<string, string>>(() =>
    initial ? { [initial]: NEW_CHAT } : {}
  );
  const [custom, setCustom] = useState<{
    on: boolean;
    name: string;
    source: string;
  }>({ on: false, name: "", source: NEW_CHAT });
  const run = useAddLeads(setup.workspaceId);
  const customKind = custom.on ? kindFromName(custom.name) : null;
  const taken = new Set(
    [...setup.choices, ...setup.custom]
      .filter((c) => c.sessionId)
      .map((c) => c.kind)
  );
  const customClash =
    !!customKind && (taken.has(customKind) || customKind in picks);
  const all: LeadPick[] = [
    ...Object.entries(picks).map(([kind, source]) => ({ kind, source })),
    ...(customKind && !customClash
      ? [{ kind: customKind, source: custom.source }]
      : []),
  ];
  const plan = addPlan(setup.hasLeads, all);
  const chosen = new Set(all.map((p) => p.source));
  const offer = (mine: string) =>
    setup.candidates.filter(
      (c) => c.sessionId === mine || !chosen.has(c.sessionId)
    );
  // A chat whose name points at the lead is offered first; the select can
  // still start a new one.
  const toggle = (kind: string) =>
    setPicks(({ [kind]: had, ...rest }) => {
      if (had) return rest;
      const hint = setup.candidates.find(
        (c) => c.suggest === kind && !chosen.has(c.sessionId)
      );
      return { ...rest, [kind]: hint?.sessionId ?? NEW_CHAT };
    });

  if (!setup.enabled)
    return (
      <div className="px-4 pb-6">
        <Notice
          action={
            <Button
              size="sm"
              className="h-11 md:h-8"
              onClick={() => {
                leadsUiActions.close();
                settingsUiActions.open("experiments");
              }}
            >
              Open Experiments
            </Button>
          }
        >
          Leads is off. Turn it on in Settings → Experiments first.
        </Notice>
      </div>
    );

  const submit = () =>
    run.mutate(plan, {
      onSuccess: ({ failed }) => {
        failed.forEach((f) => toast.error(f));
        if (!failed.length) toast.success(`Leads added to ${setup.workspace}`);
        sidebarUiActions.setWorkspace(setup.workspaceId);
        leadsUiActions.close();
      },
      onError: (e) => toast.error(e.message),
    });

  return (
    <>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-2">
        {setup.choices.map((c) => {
          if (c.kind === TECH)
            return (
              <LeadOption
                key={c.kind}
                kind={c.kind}
                title={c.title}
                checked
                locked
                detail={
                  setup.hasLeads
                    ? "Added. Your orchestrator, which lands all code."
                    : setup.hasOrchestrator
                      ? "Your orchestrator, renamed. Nothing moves."
                      : "Starts this workspace's orchestrator."
                }
              />
            );
          if (c.sessionId)
            return (
              <LeadOption
                key={c.kind}
                kind={c.kind}
                title={c.title}
                checked
                locked
                detail="Added"
              />
            );
          const picked = picks[c.kind];
          const hint = setup.candidates.find((x) => x.suggest === c.kind);
          return (
            <LeadOption
              key={c.kind}
              kind={c.kind}
              title={c.title}
              checked={!!picked}
              onToggle={() => toggle(c.kind)}
              detail={
                hint && !picked
                  ? `Or adopt an existing chat: “${hint.name}”`
                  : c.areaText
              }
            >
              {picked && setup.candidates.length > 0 && (
                <StartAs
                  label={`How the ${c.title} starts`}
                  value={picked}
                  candidates={offer(picked)}
                  onChange={(v) => setPicks((p) => ({ ...p, [c.kind]: v }))}
                />
              )}
            </LeadOption>
          );
        })}
        {setup.custom.map((c) => (
          <LeadOption
            key={c.kind}
            kind={c.kind}
            title={c.title}
            checked
            locked
            detail="Added"
          />
        ))}
        <LeadOption
          kind="custom"
          letter="+"
          title="Custom lead"
          checked={custom.on}
          onToggle={() => setCustom((c) => ({ ...c, on: !c.on }))}
          detail="A name and a blank charter you write"
        >
          {custom.on && (
            <div className="space-y-2">
              <Input
                autoFocus
                value={custom.name}
                placeholder="Design"
                aria-label="Custom lead's name"
                onChange={(e) =>
                  setCustom((c) => ({ ...c, name: e.target.value }))
                }
                className="h-11 md:h-9"
              />
              {customClash && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  This workspace already has that lead.
                </p>
              )}
              {setup.candidates.length > 0 && (
                <StartAs
                  label="How the custom lead starts"
                  value={custom.source}
                  candidates={offer(custom.source)}
                  onChange={(v) => setCustom((c) => ({ ...c, source: v }))}
                />
              )}
            </div>
          )}
        </LeadOption>
        <p className="text-muted-foreground px-1 pt-1 text-xs leading-relaxed">
          {setup.hasLeads
            ? "This workspace has its chief of staff already. "
            : "Adding leads also makes this workspace's chief of staff, never automatically. "}
          Only the Tech lead merges code. An adopted chat keeps its whole
          conversation: it writes a memo and suggests pins, and switches over
          once you confirm them.
        </p>
      </div>
      <div className="flex gap-2 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button
          variant="ghost"
          className="h-11 flex-1 md:h-9"
          onClick={() => leadsUiActions.close()}
        >
          Cancel
        </Button>
        <Button
          className="h-11 flex-[2] md:h-9"
          disabled={plan.count === 0 || run.isPending}
          onClick={submit}
        >
          {run.isPending && <Loader2 className="animate-spin" />}
          {addLabel(plan, setup.hasLeads)}
        </Button>
      </div>
    </>
  );
}
