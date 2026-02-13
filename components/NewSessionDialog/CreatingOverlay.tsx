"use client";

import type { LucideIcon } from "lucide-react";
import { Loader2, GitBranch, Package, FileCode, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepConfig {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface CreatingOverlayProps {
  isWorktree: boolean;
  step: string;
  /** Override default steps and hint text */
  steps?: StepConfig[];
  hint?: string;
}

const worktreeSteps: StepConfig[] = [
  { id: "worktree", label: "Creating worktree", icon: GitBranch },
  { id: "setup", label: "Setting up environment", icon: Package },
  { id: "done", label: "Finalizing", icon: FileCode },
];

export function CreatingOverlay({
  isWorktree,
  step,
  steps,
  hint,
}: CreatingOverlayProps) {
  const baseClasses =
    "fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-background/95 backdrop-blur-sm";

  const resolvedSteps = steps ?? (isWorktree ? worktreeSteps : null);

  if (!resolvedSteps) {
    return (
      <div className={baseClasses}>
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <p className="text-sm font-medium">Creating session...</p>
      </div>
    );
  }

  const currentIndex = resolvedSteps.findIndex((s) => s.id === step);

  return (
    <div className={cn(baseClasses, "gap-6")}>
      <Loader2 className="text-primary h-8 w-8 animate-spin" />
      <div className="space-y-3">
        {resolvedSteps.map((s, index) => {
          const Icon = s.icon;
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;

          return (
            <div
              key={s.id}
              className={cn(
                "flex items-center gap-3 text-sm transition-colors",
                isComplete && "text-muted-foreground",
                isCurrent && "text-foreground font-medium",
                !isComplete && !isCurrent && "text-muted-foreground/50"
              )}
            >
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full",
                  isComplete && "bg-primary/20 text-primary",
                  isCurrent && "bg-primary text-primary-foreground",
                  !isComplete && !isCurrent && "bg-muted"
                )}
              >
                {isComplete ? (
                  <Check className="h-3.5 w-3.5" />
                ) : isCurrent ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
              </div>
              <span>{s.label}</span>
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        {hint ?? "This may take a minute for large codebases"}
      </p>
    </div>
  );
}
