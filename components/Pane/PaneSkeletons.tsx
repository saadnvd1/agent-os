"use client";

import { ShimmeringLoader } from "@/components/ui/skeleton";
import { Terminal, FolderOpen, GitBranch } from "lucide-react";

export function TerminalSkeleton() {
  return (
    <div className="h-full w-full bg-background flex flex-col items-center justify-center gap-3">
      <Terminal className="w-8 h-8 text-muted-foreground/50 animate-pulse" />
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-primary/50 rounded-full animate-pulse" />
        <span className="text-sm text-muted-foreground">Connecting...</span>
      </div>
    </div>
  );
}

export function FileExplorerSkeleton() {
  return (
    <div className="h-full w-full bg-background p-4">
      <div className="flex items-center gap-2 mb-4">
        <FolderOpen className="w-4 h-4 text-muted-foreground/50" />
        <ShimmeringLoader className="w-32 h-4" />
      </div>
      <div className="space-y-2 pl-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <ShimmeringLoader className="w-4 h-4" delayIndex={i} />
            <ShimmeringLoader className="w-24 h-4" delayIndex={i} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function GitPanelSkeleton() {
  return (
    <div className="h-full w-full bg-background p-4">
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="w-4 h-4 text-muted-foreground/50" />
        <ShimmeringLoader className="w-24 h-4" />
      </div>
      <div className="space-y-3">
        <ShimmeringLoader className="w-full h-8 rounded" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <ShimmeringLoader className="w-4 h-4" delayIndex={i} />
              <ShimmeringLoader className="flex-1 h-4" delayIndex={i} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
