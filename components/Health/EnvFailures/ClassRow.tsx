"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useEnvSessions, useSetEnvFix } from "@/data/health";
import type { EnvClassView } from "@/lib/health/env/types";
import { SessionList } from "./SessionList";

function Fix({ view }: { view: EnvClassView }) {
  const save = useSetEnvFix();
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null)
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">
          Fix it sends {view.fixOverridden && "(this machine's text)"}
        </p>
        <p className="text-muted-foreground text-sm">
          {view.fix ?? "None: recorded and escalated only."}
        </p>
        <Button
          variant="outline"
          className="min-h-11 md:min-h-8"
          onClick={() => setDraft(view.fix ?? "")}
        >
          Edit
        </Button>
      </div>
    );
  const done = () => setDraft(null);
  return (
    <div className="space-y-2">
      <Textarea
        aria-label={`Fix text for ${view.label}`}
        value={draft}
        maxLength={500}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          className="min-h-11 md:min-h-8"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({ class: view.id, fix: draft }, { onSuccess: done })
          }
        >
          Save
        </Button>
        {view.fixOverridden && (
          <Button
            variant="outline"
            className="min-h-11 md:min-h-8"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({ class: view.id, fix: null }, { onSuccess: done })
            }
          >
            Use default
          </Button>
        )}
        <Button variant="ghost" className="min-h-11 md:min-h-8" onClick={done}>
          Cancel
        </Button>
      </div>
      {save.error && (
        <p role="alert" className="text-destructive text-sm">
          {save.error.message}
        </p>
      )}
    </div>
  );
}

export function ClassRow({ view }: { view: EnvClassView }) {
  const [open, setOpen] = useState(false);
  const sessions = useEnvSessions(view.id, open);
  return (
    <li className="border-border/60 border-b px-3 py-1 last:border-b-0">
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium">{view.label}</span>
          <Badge variant="warning">{view.sessions7} in 7d</Badge>
          <Badge variant="secondary">{view.sessions30} in 30d</Badge>
          <span className="text-muted-foreground min-w-0 basis-full text-xs">
            {view.projects
              .slice(0, 4)
              .map((p) => `${p.name} ${p.sessions7}/${p.sessions30}`)
              .join(" · ")}
          </span>
        </summary>
        <div className="space-y-3 pb-3">
          <Fix view={view} />
          <SessionList
            pending={sessions.isPending}
            error={sessions.error?.message}
            sessions={sessions.data?.sessions ?? []}
          />
        </div>
      </details>
    </li>
  );
}
