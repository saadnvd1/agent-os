import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  info: {
    box: "bg-muted/60",
    icon: <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />,
  },
  warning: {
    box: "bg-amber-500/10",
    icon: (
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
    ),
  },
} as const;

/** A short message in a tinted box, with an optional action on the right. */
export function Notice({
  tone = "info",
  action,
  className,
  children,
}: {
  tone?: keyof typeof TONES;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-2 rounded-lg p-3 text-sm sm:flex-row sm:items-center",
        TONES[tone].box,
        className
      )}
    >
      <div className="flex min-w-0 flex-1 gap-2">
        {TONES[tone].icon}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {action}
    </div>
  );
}
