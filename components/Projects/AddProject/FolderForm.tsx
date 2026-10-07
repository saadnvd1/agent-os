"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useInitProject } from "@/data/projects";
import { FolderBrowser } from "./FolderBrowser";

export function FolderForm({
  hostId,
  onDone,
}: {
  hostId: string;
  onDone: (projectId: string) => void;
}) {
  const [path, setPath] = useState("~");
  const init = useInitProject();
  return (
    <div className="space-y-3">
      <FolderBrowser hostId={hostId} path={path} onNavigate={setPath} />
      {init.error && (
        <p className="text-destructive text-sm">{init.error.message}</p>
      )}
      <Button
        className="h-11 w-full md:h-9"
        disabled={init.isPending}
        onClick={() =>
          init.mutate({ hostId, path }, { onSuccess: (p) => onDone(p.id) })
        }
      >
        {init.isPending ? "Adding…" : "Use this folder"}
      </Button>
    </div>
  );
}
