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
    <div className="border border-border rounded-lg overflow-hidden">
      {/* File header */}
      <button
        onClick={handleToggle}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2.5 text-sm",
          "bg-muted/50 hover:bg-muted transition-colors text-left",
          "min-h-[44px]" // Mobile touch target
        )}
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
        )}

        <span className="flex-1 truncate font-mono text-xs">{fileName}</span>

        {/* Stats */}
        <span className="flex items-center gap-2 text-xs flex-shrink-0">
          {diff.additions > 0 && (
            <span className="flex items-center gap-0.5 text-green-500">
              <Plus className="w-3 h-3" />
              {diff.additions}
            </span>
          )}
          {diff.deletions > 0 && (
            <span className="flex items-center gap-0.5 text-red-500">
              <Minus className="w-3 h-3" />
              {diff.deletions}
            </span>
          )}
        </span>
      </button>

      {/* Diff content */}
      {isExpanded && (
        <div className="overflow-x-auto">
          {diff.isBinary ? (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
              Binary file not shown
            </div>
          ) : diff.hunks.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
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
      <div className="px-3 py-1 bg-blue-500/10 text-blue-400 border-y border-border text-xs">
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
      <td className="w-12 px-2 py-0.5 text-right text-muted-foreground select-none border-r border-border/50 tabular-nums">
        {line.oldLineNumber || ""}
      </td>

      {/* New line number */}
      <td className="w-12 px-2 py-0.5 text-right text-muted-foreground select-none border-r border-border/50 tabular-nums">
        {line.newLineNumber || ""}
      </td>

      {/* Line marker */}
      <td
        className={cn(
          "w-6 px-1 py-0.5 text-center select-none",
          textColor
        )}
      >
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
