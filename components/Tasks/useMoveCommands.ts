"use client";

import { ArrowRightLeft } from "lucide-react";
import type { Session } from "@/lib/db";
import { movableSession } from "@/lib/tasks/move-targets";
import { usePaletteCommands } from "@/hooks/usePaletteCommands";
import { useMoveSession, useMoveTargets } from "@/data/tasks";

// ⌘K "Move this task to <machine>" for the focused session, when it can move.
export function useMoveCommands(session: Session | undefined) {
  // A move it can't take yet is the menus' to explain, not the palette's.
  const targets = useMoveTargets(
    session ? movableSession(session) : null
  ).filter((t) => !t.blocked);
  const move = useMoveSession();
  usePaletteCommands(
    "move",
    session && targets.length
      ? targets.map((t) => ({
          id: `move.${t.hostId}`,
          title:
            t.hostId === "local"
              ? "Move this task back to this machine"
              : `Move this task to ${t.name}`,
          group: "Task",
          keywords: ["machine", "host", "migrate", "transfer", t.name],
          icon: ArrowRightLeft,
          run: () =>
            move(
              { id: session.id, name: session.name, hostId: session.host_id },
              t
            ),
        }))
      : null
  );
}
