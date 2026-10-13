import type { RunStatus } from "@/lib/recipes/types";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE } from "./format";

export function RunChip({ status }: { status: RunStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        STATUS_TONE[status]
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
