"use client";

import { useState } from "react";
import { ListSection } from "@/components/Settings/ListSection";
import { SettingSection } from "@/components/Settings/SettingRow";
import { SwitchSetting } from "@/components/Settings/settings-fields";
import { MergeApprovalToggle } from "@/components/Merge/MergeApprovalToggle";
import { useApprovalsModeQuery, useSetApprovalsMode } from "@/data/approvals";
import type { ApprovalLine } from "@/lib/approvals/describe";

// What it switches off, said plainly before it can be switched on.
export const NO_APPROVALS_WARNING = [
  "Every ask is approved the moment it is raised, hard lines included: public posts and messages, money, irreversible or destructive changes, credentials.",
  "A PR stuck failing its gates, with no CI, or too big to review still merges.",
  "Brakes stop holding new starts. Plan-only tasks still wait for approve_plan.",
  "Every agent AgentOS starts runs with its permission prompts off, and prompts already waiting are allowed.",
  "Terminals already running in an agent other than Claude keep asking until they are restarted. Each approval made for you is logged here.",
];

const when = (at: string) =>
  new Date(`${at.replace(" ", "T")}Z`).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function Line({ line }: { line: ApprovalLine }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-3 py-2.5 text-sm">
      <p className="break-words">{line.summary}</p>
      <p className="text-muted-foreground text-xs">
        {line.where} · {when(line.at)}
        {line.details && (
          <>
            {" · "}
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="text-primary -my-3 min-h-11 hover:underline"
            >
              {open ? "Hide details" : "Details"}
            </button>
          </>
        )}
      </p>
      {open && line.details && (
        <code className="bg-foreground/[0.05] mt-1 block rounded px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap">
          {line.details}
        </code>
      )}
    </div>
  );
}

// Every approval AgentOS would wait on, in one place: the master switch, the
// merge gate, and what the switch approved for you.
export function ApprovalsSection() {
  const { data, isPending, isError, error } = useApprovalsModeQuery();
  const set = useSetApprovalsMode();

  if (isPending)
    return <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;

  return (
    <div className="space-y-5">
      <SettingSection>
        <SwitchSetting
          id="no-approvals"
          label="No approvals"
          help="Shuts off every approval AgentOS would otherwise wait on, and every agent's permission prompts."
          checked={data.on}
          defaultValue={false}
          confirm={NO_APPROVALS_WARNING.join(" ")}
          confirmLabel="Turn on No approvals"
          onSave={(on) => set.mutateAsync(on)}
        />
        <MergeApprovalToggle overriddenBy={data.on} />
      </SettingSection>
      <ListSection
        title="Approved for you"
        items={data.audit}
        keyOf={(l) => String(l.id)}
        render={(l) => <Line line={l} />}
        empty="Nothing yet."
      />
    </div>
  );
}
