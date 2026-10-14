import { toast } from "sonner";
import type { Session } from "@/lib/db";
import {
  usePauseSession,
  useResumeSession,
  useSettleSession,
  useSnoozeSession,
} from "@/data/sessions/shelf";
import {
  pauseUntil,
  snoozePreset,
  wakeLabel,
  type PausePreset,
  type SnoozePreset,
} from "@/lib/sidebar/snooze";

// A row menu's Snooze, Unsnooze, Pause, Resume, Mark done and Reopen.
export function useShelfActions() {
  const snooze = useSnoozeSession();
  const settle = useSettleSession();
  const pause = usePauseSession();
  const resume = useResumeSession();
  const unsnooze = (session: Session) =>
    snooze.mutate({ id: session.id, until: null });
  return {
    snooze: (session: Session, preset: SnoozePreset) => {
      const until = snoozePreset(preset);
      snooze.mutate(
        { id: session.id, until },
        {
          onSuccess: () =>
            toast.success(`Snoozed until ${wakeLabel(until.getTime())}`, {
              action: { label: "Undo", onClick: () => unsnooze(session) },
            }),
          onError: (e) => toast.error(e.message),
        }
      );
    },
    unsnooze,
    // Stops its agent at the end of the step (or now) and starts it again at
    // the time. A refusal (it is waiting on you, merging) is the toast.
    pause: (session: Session, preset: PausePreset, now = false) => {
      const until = pauseUntil(preset);
      pause.mutate(
        { id: session.id, until, mode: now ? "now" : "turn" },
        {
          onSuccess: () =>
            toast.success(
              until
                ? `Pausing until ${wakeLabel(until.getTime())}`
                : "Pausing until you resume",
              {
                action: {
                  label: "Keep running",
                  onClick: () => resume.mutate({ id: session.id }),
                },
              }
            ),
          onError: (e) => toast.error(e.message),
        }
      );
    },
    resume: (session: Session) =>
      resume.mutate(
        { id: session.id },
        { onError: (e) => toast.error(e.message) }
      ),
    settle: (session: Session) =>
      settle.mutate(
        { id: session.id, settled: true },
        {
          onSuccess: () =>
            toast.success("Marked done", {
              action: {
                label: "Undo",
                onClick: () =>
                  settle.mutate({ id: session.id, settled: false }),
              },
            }),
          onError: (e) => toast.error(e.message),
        }
      ),
    reopen: (session: Session) =>
      settle.mutate({ id: session.id, settled: false }),
  };
}
