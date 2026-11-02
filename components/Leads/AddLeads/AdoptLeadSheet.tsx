"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAddLeads, useLeadSetup } from "@/data/leads";
import { leadsUi, leadsUiActions } from "@/stores/leadsUi";
import { kindFromName } from "@/lib/leads/order";
import { TECH } from "@/lib/leads/types";
import type { LeadSetupView } from "@/lib/leads/setup";
import { LeadOption } from "./LeadOption";
import { LeadsSheetFrame, SheetSkeleton } from "./AddLeadsSheet";

const CUSTOM = "custom";

// A chat's menu → Adopt as lead: it becomes one of its workspace's leads and
// keeps its id, its chat and its conversation. It writes a memo and suggests
// pins; it switches over to a fresh start only once you confirm them.
export function AdoptLeadSheet() {
  const { adopt } = useSnapshot(leadsUi);
  const { data: setup } = useLeadSetup(adopt?.workspaceId ?? null);
  return (
    <LeadsSheetFrame
      open={!!adopt}
      title="Adopt as lead"
      description={
        adopt
          ? `“${adopt.name}” keeps its whole conversation. It writes a memo and suggests pins from your messages, and switches over once you confirm them.`
          : ""
      }
    >
      {adopt && !setup && <SheetSkeleton />}
      {adopt && setup && (
        <AdoptForm
          key={adopt.sessionId}
          setup={setup}
          sessionId={adopt.sessionId}
        />
      )}
    </LeadsSheetFrame>
  );
}

function AdoptForm({
  setup,
  sessionId,
}: {
  setup: LeadSetupView;
  sessionId: string;
}) {
  const open = setup.choices.filter((c) => c.kind !== TECH && !c.sessionId);
  const suggested = setup.candidates.find(
    (c) => c.sessionId === sessionId
  )?.suggest;
  const [pick, setPick] = useState<string>(
    suggested ?? open[0]?.kind ?? CUSTOM
  );
  const [name, setName] = useState("");
  const run = useAddLeads(setup.workspaceId);
  const taken = new Set(
    [...setup.choices, ...setup.custom]
      .filter((c) => c.sessionId)
      .map((c) => c.kind)
  );
  const custom = kindFromName(name);
  const kind =
    pick === CUSTOM ? (custom && !taken.has(custom) ? custom : null) : pick;
  const title =
    pick === CUSTOM
      ? "the custom lead"
      : `the ${open.find((c) => c.kind === pick)?.title ?? "lead"}`;

  const submit = () =>
    kind &&
    run.mutate(
      { kinds: [], adopt: [{ sessionId, kind }] },
      {
        onSuccess: ({ failed }) => {
          if (failed.length) return failed.forEach((f) => toast.error(f));
          toast.success(`Adopted as ${title}`);
          leadsUiActions.close();
        },
        onError: (e) => toast.error(e.message),
      }
    );

  return (
    <>
      <div
        role="radiogroup"
        aria-label="Which lead"
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-2"
      >
        {open.map((c) => (
          <LeadOption
            key={c.kind}
            kind={c.kind}
            title={c.title}
            detail={c.areaText}
            radio
            checked={pick === c.kind}
            onToggle={() => setPick(c.kind)}
          />
        ))}
        <LeadOption
          kind={CUSTOM}
          letter="+"
          title="Custom lead"
          detail="A name and a blank charter you write"
          radio
          checked={pick === CUSTOM}
          onToggle={() => setPick(CUSTOM)}
        >
          {pick === CUSTOM && (
            <Input
              autoFocus
              value={name}
              placeholder="Design"
              aria-label="Custom lead's name"
              onChange={(e) => setName(e.target.value)}
              className="h-11 md:h-9"
            />
          )}
        </LeadOption>
        <p className="text-muted-foreground px-1 pt-1 text-xs leading-relaxed">
          {setup.hasLeads
            ? `It joins the ${setup.workspace} team.`
            : `${setup.workspace} has no leads yet: this also adds its chief of staff and its Tech lead (your orchestrator, in place).`}{" "}
          Until you confirm its pins, nothing it suggests counts as your
          direction.
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
          disabled={!kind || run.isPending}
          onClick={submit}
        >
          {run.isPending && <Loader2 className="animate-spin" />}
          Adopt as {title}
        </Button>
      </div>
    </>
  );
}
