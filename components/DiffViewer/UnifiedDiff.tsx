"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParsedDiff, DiffHunk, DiffLine } from "@/lib/diff-parser";

interface UnifiedDiffProps {
  diff: ParsedDiff;
  fileName: string;
  expanded?: boolean;
  onToggle?: () => void;
}

export function UnifiedDiff({
  diff,
  fileName,
  expanded = true,
  onToggle,
}: UnifiedDiffProps) {
  const [localExpanded, setLocalExpanded] = useState(expanded);
  const isExpanded = onToggle ? expanded : localExpanded;

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setLocalExpanded(!localExpanded);
    }
  };

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      {/* File header */}
      <button
        onClick={handleToggle}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2.5 text-sm",
          "bg-muted/50 hover:bg-muted text-left transition-colors",
          "min-h-[44px]" // Mobile touch target
        )}
      >
        {isExpanded ? (
          <ChevronDown className="text-muted-foreground h-4 w-4 flex-shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground h-4 w-4 flex-shrink-0" />
        )}

        <span className="flex-1 truncate font-mono text-xs">{fileName}</span>

        {/* Stats */}
        <span className="flex flex-shrink-0 items-center gap-2 text-xs">
          {diff.additions > 0 && (
            <span className="flex items-center gap-0.5 text-green-500">
              <Plus className="h-3 w-3" />
              {diff.additions}
            </span>
          )}
          {diff.deletions > 0 && (
            <span className="flex items-center gap-0.5 text-red-500">
              <Minus className="h-3 w-3" />
              {diff.deletions}
            </span>
          )}
        </span>
      </button>

      {/* Diff content */}
      {isExpanded && (
        <div className="overflow-x-auto">
          {diff.isBinary ? (
            <div className="text-muted-foreground px-4 py-8 text-center text-sm">
              Binary file not shown
            </div>
          ) : diff.hunks.length === 0 ? (
            <div className="text-muted-foreground px-4 py-8 text-center text-sm">
              No changes
            </div>
          ) : (
            <div className="font-mono text-xs">
              {diff.hunks.map((hunk, index) => (
                <Hunk key={index} hunk={hunk} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface HunkProps {
  hunk: DiffHunk;
}

function Hunk({ hunk }: HunkProps) {
  return (
    <div>
      {/* Hunk header */}
      <div className="border-border border-y bg-blue-500/10 px-3 py-1 text-xs text-blue-400">
        {hunk.header}
      </div>

      {/* Lines */}
      <table className="w-full border-collapse">
        <tbody>
          {hunk.lines.map((line, index) => (
            <DiffLineRow key={index} line={line} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DiffLineRowProps {
  line: DiffLine;
}

function DiffLineRow({ line }: DiffLineRowProps) {
  const bgColor = getLineBgColor(line.type);
  const textColor = getLineTextColor(line.type);

  // Skip header lines in the main content
  if (line.type === "header") {
    return null;
  }

  return (
    <tr className={cn("hover:bg-muted/30", bgColor)}>
      {/* Old line number */}
      <td className="text-muted-foreground border-border/50 w-12 border-r px-2 py-0.5 text-right tabular-nums select-none">
        {line.oldLineNumber || ""}
      </td>

      {/* New line number */}
      <td className="text-muted-foreground border-border/50 w-12 border-r px-2 py-0.5 text-right tabular-nums select-none">
        {line.newLineNumber || ""}
      </td>

      {/* Line marker */}
      <td className={cn("w-6 px-1 py-0.5 text-center select-none", textColor)}>
        {getLineMarker(line.type)}
      </td>

      {/* Content */}
      <td className={cn("px-2 py-0.5 whitespace-pre", textColor)}>
        {line.content || " "}
      </td>
    </tr>
  );
}

function getLineBgColor(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "bg-green-500/10";
    case "deletion":
      return "bg-red-500/10";
    default:
      return "";
  }
}

function getLineTextColor(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "text-green-400";
    case "deletion":
      return "text-red-400";
    default:
      return "text-foreground";
  }
}

function getLineMarker(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "+";
    case "deletion":
      return "-";
    default:
      return "";
  }
}
