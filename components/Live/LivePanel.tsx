"use client";

import { toast } from "sonner";
import { useEndLive, useLiveAction, useLiveShare } from "@/data/live";
import { liveUiActions } from "@/stores/liveUi";
import { DriveBanner } from "./DriveBanner";
import { GuestPromptCard } from "./GuestPromptCard";
import { LiveChip } from "./LiveChip";
import { LobbyCard } from "./LobbyCard";

// Above the composer while a session has a live link: the Live chip, who is
// driving, who is waiting to come in, and the suggestions to send, edit or
// dismiss.
export function LivePanel({
  sessionId,
  title,
  onEdit,
}: {
  sessionId: string;
  title: string;
  onEdit: (text: string) => void;
}) {
  const query = useLiveShare(sessionId);
  const share = query.data?.share;
  const act = useLiveAction(share?.id ?? "");
  const end = useEndLive(share?.id ?? "");
  if (!share) return null;
  const busy = act.isPending || end.isPending;
  const fail = (e: Error) => toast.error(e.message);
  const doAction = (guestId: string, kind: string) => {
    if (kind === "admit" || kind === "deny" || kind === "kick")
      act.mutate({ action: kind, guestId }, { onError: fail });
    else if (kind === "admit_drive")
      act.mutate({ action: "admit", guestId, drive: true }, { onError: fail });
    else if (kind === "give_wheel")
      act.mutate({ action: "wheel", guestId }, { onError: fail });
    else if (kind === "take_back")
      act.mutate({ action: "wheel", guestId: null }, { onError: fail });
  };
  const lobby = share.guests.filter((g) => g.status === "pending");
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-3 pb-2">
      <LiveChip
        share={share}
        busy={busy}
        onAction={doAction}
        onLevel={(level) =>
          act.mutate({ action: "level", level }, { onError: fail })
        }
        onEnd={() => end.mutate(undefined, { onError: fail })}
        onInvite={() => liveUiActions.open(sessionId, title)}
      />
      {share.banner && share.driver && (
        <DriveBanner
          banner={share.banner}
          busy={busy}
          onTakeBack={() =>
            act.mutate({ action: "wheel", guestId: null }, { onError: fail })
          }
        />
      )}
      {lobby.map((g) => (
        <LobbyCard
          key={g.id}
          guest={g}
          busy={busy}
          onAction={(kind) => doAction(g.id, kind)}
        />
      ))}
      {share.suggestions.map((s) => (
        <GuestPromptCard
          key={s.id}
          suggestion={s}
          busy={busy}
          onSend={() =>
            act.mutate(
              { action: "send", suggestionId: s.id },
              { onError: fail }
            )
          }
          onEdit={() => {
            onEdit(s.text);
            act.mutate(
              { action: "dismiss", suggestionId: s.id },
              { onError: fail }
            );
          }}
          onDismiss={() =>
            act.mutate(
              { action: "dismiss", suggestionId: s.id },
              { onError: fail }
            )
          }
        />
      ))}
    </div>
  );
}
