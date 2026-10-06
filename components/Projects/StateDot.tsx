import type { AgentState } from "@/lib/session-meta";
import { cn } from "@/lib/utils";

// One meaning per colour: primary working, red needs you,
// an amber ring for your turn, nothing when idle.
const TONE: Record<AgentState, string | null> = {
  working: "bg-primary",
  blocked: "bg-destructive",
  waiting: "bg-sidebar-background border-[1.5px] border-amber-400",
  idle: null,
};

export function StateDot({
  state,
  className,
}: {
  state: AgentState;
  className?: string;
}) {
  const tone = TONE[state];
  if (!tone) return null;
  return (
    <span
      aria-label={state}
      className={cn(
        "ring-sidebar-background block h-2 w-2 rounded-full ring-2",
        tone,
        className
      )}
    />
  );
}
