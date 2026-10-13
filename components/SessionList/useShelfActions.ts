import { toast } from "sonner";
import type { Session } from "@/lib/db";
import { useSettleSession, useSnoozeSession } from "@/data/sessions/shelf";
import {
  snoozePreset,
  wakeLabel,
  type SnoozePreset,
} from "@/lib/sidebar/snooze";

// A row menu's Snooze, Unsnooze, Mark done and Reopen, each with an Undo.
export function useShelfActions() {
  const snooze = useSnoozeSession();
  const settle = useSettleSession();
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
