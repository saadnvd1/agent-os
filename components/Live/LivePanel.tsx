"use client";

import { toast } from "sonner";
import { useEndLive, useLiveAction, useLiveShare } from "@/data/live";
import { liveUiActions } from "@/stores/liveUi";
import { GuestPromptCard } from "./GuestPromptCard";
import { LiveChip } from "./LiveChip";
import { LobbyCard } from "./LobbyCard";

// Above the composer while a session has a live link: the Live chip, who is
// waiting to come in, and the suggestions to send, edit or dismiss.
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
  const lobby = share.guests.filter((g) => g.status === "pending");
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-3 pb-2">
      <LiveChip
        share={share}
        busy={busy}
        onKick={(guestId) =>
          act.mutate({ action: "kick", guestId }, { onError: fail })
        }
        onEnd={() => end.mutate(undefined, { onError: fail })}
        onInvite={() => liveUiActions.open(sessionId, title)}
      />
      {lobby.map((g) => (
        <LobbyCard
          key={g.id}
          guest={g}
          busy={busy}
          onAdmit={() =>
            act.mutate({ action: "admit", guestId: g.id }, { onError: fail })
          }
          onDeny={() =>
            act.mutate({ action: "deny", guestId: g.id }, { onError: fail })
          }
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
