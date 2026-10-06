import type { AgentState } from "@/lib/session-meta";
import { StateDot } from "./StateDot";
import { cn } from "@/lib/utils";

// A letter tile with a muted hue derived from the name, dimmed when nothing
// runs in the project, with its busiest agent's state on the corner.
export function ProjectAvatar({
  name,
  state = "idle",
  dim = false,
}: {
  name: string;
  state?: AgentState;
  dim?: boolean;
}) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="relative shrink-0">
      <span
        aria-hidden
        style={{ "--avatar-hue": hash % 360 } as React.CSSProperties}
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-semibold transition-opacity",
          "bg-[hsl(var(--avatar-hue)_30%_88%)] text-[hsl(var(--avatar-hue)_35%_28%)]",
          "dark:bg-[hsl(var(--avatar-hue)_25%_24%)] dark:text-[hsl(var(--avatar-hue)_40%_80%)]",
          dim && "opacity-50"
        )}
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
      <StateDot state={state} className="absolute -right-0.5 -bottom-0.5" />
    </span>
  );
}
