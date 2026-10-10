"use client";

import { ChevronLeft, Folder, GitBranch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFolderListing } from "@/data/projects";

// Folders on a machine, one level at a time.
export function FolderBrowser({
  hostId,
  path,
  onNavigate,
}: {
  hostId: string;
  path: string;
  onNavigate: (path: string) => void;
}) {
  const { data, isLoading, error } = useFolderListing(hostId, path);
  return (
    <div className="border-border/70 overflow-hidden rounded-lg border">
      <div className="bg-muted/40 flex items-center gap-1 border-b px-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Up a folder"
          className="h-11 w-11 shrink-0 md:h-8 md:w-8"
          disabled={!data?.parent}
          onClick={() => data?.parent && onNavigate(data.parent)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {data?.path ?? path}
        </span>
        {data?.isGitRepo && (
          <span className="text-muted-foreground flex shrink-0 items-center gap-1 pr-2 text-xs">
            <GitBranch className="h-3 w-3" /> git
          </span>
        )}
      </div>
      {data?.warning && (
        <p
          role="note"
          className="border-b bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
        >
          {data.warning}
        </p>
      )}
      <div className="max-h-64 overflow-y-auto p-1">
        {isLoading && (
          <Loader2 className="text-muted-foreground mx-auto my-6 h-4 w-4 animate-spin" />
        )}
        {error && (
          <p className="text-destructive p-3 text-xs">{error.message}</p>
        )}
        {data?.folders.length === 0 && (
          <p className="text-muted-foreground p-3 text-xs">No folders here.</p>
        )}
        {data?.folders.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onNavigate(`${data.path.replace(/\/$/, "")}/${f}`)}
            className="hover:bg-foreground/[0.05] flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm md:min-h-8"
          >
            <Folder className="text-muted-foreground h-4 w-4 shrink-0" />
            <span className="truncate">{f}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
