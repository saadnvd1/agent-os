"use client";

import { Button } from "@/components/ui/button";
import { useHealthCount } from "@/data/health";
import { settingsUiActions } from "@/stores/settingsUi";
import { cn } from "@/lib/utils";

// Beside the load gauge: shown only while something is open. Amber for an
// anomaly, red when it needs the person. A tap opens Settings → Health.
export function HealthDot() {
  const { data } = useHealthCount();
  if (!data || data.open === 0) return null;
  const urgent = data.needsYou > 0;
  const label = urgent
    ? `${data.needsYou} health issue${data.needsYou === 1 ? "" : "s"} need you`
    : `${data.open} health issue${data.open === 1 ? "" : "s"} open`;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      data-health-dot={urgent ? "red" : "amber"}
      onClick={() => settingsUiActions.open("health")}
      className="h-11 w-11 shrink-0 md:h-8 md:w-6 [@media(hover:none)]:md:h-11 [@media(hover:none)]:md:w-11"
    >
      <span
        className={cn(
          "h-2 w-2 rounded-sm",
          urgent ? "bg-destructive" : "bg-amber-500"
        )}
      />
    </Button>
  );
}
