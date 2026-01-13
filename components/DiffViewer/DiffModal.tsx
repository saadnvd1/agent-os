"use client";

import { X, Plus, Minus, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnifiedDiff } from "./UnifiedDiff";
import { parseDiff, getDiffFileName, getDiffSummary } from "@/lib/diff-parser";
import { cn } from "@/lib/utils";

interface DiffModalProps {
  diff: string;
  fileName?: string;
  onClose: () => void;
  onStage?: () => void;
  onUnstage?: () => void;
  isStaged?: boolean;
}

export function DiffModal({
  diff,
  fileName,
  onClose,
  onStage,
  onUnstage,
  isStaged = false,
}: DiffModalProps) {
  const parsedDiff = parseDiff(diff);
  const displayName = fileName || getDiffFileName(parsedDiff);
  const summary = getDiffSummary(parsedDiff);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border bg-background/95 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="h-9 w-9"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>

        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate">{displayName}</h3>
          <p className="text-xs text-muted-foreground">{summary}</p>
        </div>

        {/* Stage/Unstage button */}
        {(onStage || onUnstage) && (
          <Button
            variant={isStaged ? "outline" : "default"}
            size="sm"
            onClick={isStaged ? onUnstage : onStage}
            className="h-9"
          >
            {isStaged ? (
              <>
                <Minus className="w-4 h-4 mr-1" />
                Unstage
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-1" />
                Stage
              </>
            )}
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="h-9 w-9 md:hidden"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {diff ? (
          <UnifiedDiff diff={parsedDiff} fileName={displayName} expanded={true} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">No changes to display</p>
          </div>
        )}
      </div>

      {/* Mobile action bar */}
      <div className="md:hidden flex items-center justify-between p-3 border-t border-border bg-background/95 backdrop-blur-sm safe-area-bottom">
        <div className="flex items-center gap-4">
          {parsedDiff.additions > 0 && (
            <span className="flex items-center gap-1 text-sm text-green-500">
              <Plus className="w-4 h-4" />
              {parsedDiff.additions}
            </span>
          )}
          {parsedDiff.deletions > 0 && (
            <span className="flex items-center gap-1 text-sm text-red-500">
              <Minus className="w-4 h-4" />
              {parsedDiff.deletions}
            </span>
          )}
        </div>

        {(onStage || onUnstage) && (
          <Button
            variant={isStaged ? "outline" : "default"}
            size="default"
            onClick={isStaged ? onUnstage : onStage}
            className="min-h-[44px]"
          >
            {isStaged ? "Unstage" : "Stage"}
          </Button>
        )}
      </div>
    </div>
  );
}

interface DiffViewProps {
  diff: string;
  fileName?: string;
}

/**
 * Inline diff view (non-modal)
 * For embedding in other components
 */
export function DiffView({ diff, fileName }: DiffViewProps) {
  const parsedDiff = parseDiff(diff);
  const displayName = fileName || getDiffFileName(parsedDiff);

  if (!diff) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <p className="text-sm">No changes to display</p>
      </div>
    );
  }

  return <UnifiedDiff diff={parsedDiff} fileName={displayName} expanded={true} />;
}
