import { GitPullRequest, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { chipFor, type ChipStatus } from "./status-chip";

export function StatusChip({
  status,
  attention,
  stack,
}: {
  status: ChipStatus;
  attention?: boolean;
  stack?: boolean;
}) {
  const chip = chipFor(status, { attention, stack });
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        chip.tone
      )}
    >
      {chip.icon === "spinner" && (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      )}
      {chip.icon === "pr" && <GitPullRequest className="h-3 w-3" aria-hidden />}
      {chip.label}
    </span>
  );
}
