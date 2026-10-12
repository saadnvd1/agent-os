"use client";

import { useState } from "react";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  useProjectLogsQuery,
  useSetLogFolder,
  type LogHeader,
} from "@/data/session-logs";
import { LogDocument } from "./LogDocument";

const day = (h: LogHeader) => (h.mergedAt ?? h.createdAt).slice(0, 10);

function LogRow({ log, onOpen }: { log: LogHeader; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="hover:bg-accent/50 flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition-colors"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{log.name}</span>
          <span className="text-muted-foreground block truncate text-xs">
            {day(log)}
            {log.prNumber ? ` · #${log.prNumber}` : ""}
            {` · $${log.costUsd.toFixed(2)}`}
          </span>
        </span>
        <ScrollText className="text-muted-foreground h-4 w-4 shrink-0" />
      </button>
    </li>
  );
}

// A project's logs of merged tasks, newest first, and the folder their
// files go to (the default is outside every repository).
export function ProjectLogsSection({
  projectId,
  open,
}: {
  projectId: string;
  open: boolean;
}) {
  const { data, isPending, isError, error } = useProjectLogsQuery(
    projectId,
    open
  );
  const save = useSetLogFolder(projectId);
  const [draft, setDraft] = useState<string | null>(null);
  const [viewing, setViewing] = useState<LogHeader | null>(null);
  const folder = draft ?? data?.folder ?? "";

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Session logs</h3>
      <p className="text-muted-foreground text-xs">
        When a task merges, AgentOS writes a log of it from what it already
        recorded. No model is involved.
      </p>
      <div className="space-y-1.5">
        <label htmlFor={`log-folder-${projectId}`} className="text-sm">
          Session log folder
        </label>
        <div className="flex gap-2">
          <Input
            id={`log-folder-${projectId}`}
            value={folder}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={data ? `${data.defaultFolder}/…` : "~/path/to/logs"}
            className="h-11 flex-1 md:h-9"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // Not the project form's submit.
              e.preventDefault();
              if (draft !== null)
                save.mutate(draft, { onSuccess: () => setDraft(null) });
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            disabled={save.isPending || draft === null}
            onClick={() =>
              save.mutate(draft ?? "", { onSuccess: () => setDraft(null) })
            }
          >
            Save
          </Button>
        </div>
        {save.isError && (
          <p className="text-destructive text-sm">{save.error.message}</p>
        )}
        <p className="text-muted-foreground text-xs">
          An absolute or ~ path, never inside the project&apos;s repository.
          Empty uses the default.
        </p>
      </div>
      {isPending && (
        <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />
      )}
      {isError && <p className="text-destructive text-sm">{error.message}</p>}
      {data &&
        (data.logs.length ? (
          <ul className="bg-muted/40 divide-border max-h-64 divide-y overflow-y-auto rounded-lg">
            {data.logs.map((l) => (
              <LogRow key={l.id} log={l} onOpen={() => setViewing(l)} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            No merged tasks logged yet.
          </p>
        ))}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle className="truncate">
              {viewing?.name ?? "Log"}
            </DialogTitle>
            <DialogDescription>Session log</DialogDescription>
          </DialogHeader>
          <div className="h-[70vh]">
            {viewing && <LogDocument sessionId={viewing.id} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
