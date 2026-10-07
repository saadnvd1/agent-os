"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCloneJob, useStartClone } from "@/data/projects";
import { ParentPicker } from "./ParentPicker";

export function CloneForm({
  hostId,
  onDone,
}: {
  hostId: string;
  onDone: (projectId: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("~");
  const start = useStartClone();
  const { data: job } = useCloneJob(start.data?.id ?? null);
  const running = start.isPending || job?.status === "running";
  const doneId = job?.status === "done" ? job.projectId : null;
  useEffect(() => {
    if (doneId) onDone(doneId);
  }, [doneId, onDone]);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start.mutate({ hostId, parent, url: url.trim() });
      }}
    >
      <Input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://github.com/owner/repo"
        aria-label="Repository URL"
        className="h-11 md:h-9"
        disabled={running}
      />
      <ParentPicker hostId={hostId} path={parent} onChange={setParent} />
      {(job?.log.length ?? 0) > 0 && (
        <pre className="bg-muted/50 max-h-40 overflow-auto rounded-lg p-2 font-mono text-[11px] whitespace-pre-wrap">
          {job?.log.join("\n")}
        </pre>
      )}
      {(start.error || job?.error) && (
        <p className="text-destructive text-sm break-words">
          {start.error?.message ?? job?.error}
        </p>
      )}
      <Button
        type="submit"
        className="h-11 w-full gap-2 md:h-9"
        disabled={running || !url.trim()}
      >
        {running && <Loader2 className="h-4 w-4 animate-spin" />}
        {running ? "Cloning…" : "Clone"}
      </Button>
    </form>
  );
}
