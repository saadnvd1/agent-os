"use client";

import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { ShimmeringLoader } from "@/components/ui/skeleton";
import {
  useLeadCharter,
  useSaveCharter,
  type CharterFields,
} from "@/data/leads";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { CHARTER_LIMITS } from "@/lib/leads/charter-limits";

const EMPTY: CharterFields = { title: "", area: "", goal: "", charter_md: "" };

const Field = ({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <label
      htmlFor={htmlFor}
      className="label-mono text-muted-foreground block px-1"
    >
      {label}
    </label>
    {children}
  </div>
);

function CharterForm({
  initial,
  workspaceId,
  kind,
  onDone,
}: {
  initial: CharterFields;
  workspaceId: string;
  kind: string;
  onDone: () => void;
}) {
  const [f, setF] = useState(initial);
  const save = useSaveCharter(workspaceId, kind);
  const set = (k: keyof CharterFields) => (v: string) =>
    setF((p) => ({ ...p, [k]: v }));
  const valid = f.title.trim() !== "" && f.charter_md.trim() !== "";
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(f, {
          onSuccess: (r) => {
            toast.success(
              r.delivered ? "Charter saved and sent" : "Charter saved"
            );
            onDone();
          },
          onError: (err) => toast.error(err.message),
        });
      }}
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <Field label="Title" htmlFor="charter-title">
          <Input
            id="charter-title"
            value={f.title}
            maxLength={CHARTER_LIMITS.title}
            className="h-11 md:h-9"
            onChange={(e) => set("title")(e.target.value)}
          />
        </Field>
        <Field label="Area" htmlFor="charter-area">
          <Textarea
            id="charter-area"
            value={f.area}
            maxLength={CHARTER_LIMITS.area}
            className="min-h-[60px]"
            onChange={(e) => set("area")(e.target.value)}
          />
        </Field>
        <Field label="Goal" htmlFor="charter-goal">
          <Textarea
            id="charter-goal"
            value={f.goal}
            maxLength={CHARTER_LIMITS.goal}
            className="min-h-[60px]"
            onChange={(e) => set("goal")(e.target.value)}
          />
        </Field>
        <Field label="Charter (markdown)" htmlFor="charter-md">
          <Textarea
            id="charter-md"
            value={f.charter_md}
            maxLength={CHARTER_LIMITS.charter}
            className="min-h-[220px] font-mono"
            onChange={(e) => set("charter_md")(e.target.value)}
          />
        </Field>
        <p className="text-muted-foreground px-1 text-xs leading-relaxed">
          A running lead gets the new charter as its next message, after any
          turn in progress, and keeps its chat. A lead that isn&apos;t running
          reads it when it starts.
        </p>
      </div>
      <div className="flex gap-2 px-4 pt-2 pb-4">
        <Button
          type="button"
          variant="ghost"
          className="h-11 flex-1 md:h-9"
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-11 flex-1 md:h-9"
          disabled={!valid || save.isPending}
        >
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}

export function CharterSheet({
  workspaceId,
  kind,
  name,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  kind: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const wide = useMediaQuery("(min-width: 768px)");
  const q = useLeadCharter(workspaceId, kind, open);
  return (
    <ASheet open={open} onOpenChange={onOpenChange}>
      <ASheetContent
        side={wide ? "right" : "bottom"}
        className={wide ? "w-full max-w-md" : "max-h-[90dvh] rounded-t-2xl"}
      >
        <ASheetHeader className="pr-12">
          <ASheetTitle>Charter · {name}</ASheetTitle>
          <ASheetDescription>
            Who this lead is and what it owns. It reads this in its brief.
          </ASheetDescription>
        </ASheetHeader>
        {q.isPending ? (
          <div className="space-y-3 px-4 pb-6">
            <ShimmeringLoader className="h-11 w-full" />
            <ShimmeringLoader className="h-40 w-full" />
          </div>
        ) : (
          <CharterForm
            initial={q.data ?? { ...EMPTY, title: name }}
            workspaceId={workspaceId}
            kind={kind}
            onDone={() => onOpenChange(false)}
          />
        )}
      </ASheetContent>
    </ASheet>
  );
}
