"use client";

import { Pause } from "lucide-react";
import { toast } from "sonner";
import { useSessionsQuery } from "@/data/sessions";
import { useResumeSession } from "@/data/sessions/shelf";
import { pauseSubtitle } from "@/lib/sidebar/paused";
import { Button } from "@/components/ui/button";

// Above the composer while the session is paused: when it resumes, and a
// button to resume it now. What is sent meanwhile waits and goes with it.
export function PausedBanner({ sessionId }: { sessionId: string }) {
  const { data } = useSessionsQuery();
  const resume = useResumeSession();
  const session = data?.sessions.find((s) => s.id === sessionId);
  const state = session?.pause_state;
  if (!session || !state) return null;
  const until = session.paused_until
    ? Date.parse(`${session.paused_until.replace(" ", "T")}Z`)
    : null;
  return (
    <section
      aria-label="Paused"
      className="bg-card popover-surface mb-2 flex min-h-11 items-center gap-2 rounded-2xl px-3 py-1.5"
    >
      <Pause
        aria-hidden
        className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
      />
      <p className="min-w-0 flex-1 text-sm">
        {pauseSubtitle({ state, until })}
        <span className="text-muted-foreground block text-xs">
          Messages you send now are held and delivered together when it resumes.
        </span>
      </p>
      {(state === "paused" || state === "pausing") && (
        <Button
          size="sm"
          variant="secondary"
          className="min-h-11 shrink-0"
          disabled={resume.isPending}
          onClick={() =>
            resume.mutate(
              { id: sessionId },
              { onError: (e) => toast.error(e.message) }
            )
          }
        >
          {state === "paused" ? "Resume now" : "Keep running"}
        </Button>
      )}
    </section>
  );
}
