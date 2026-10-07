"use client";

import type { ComponentType, ReactNode } from "react";
import { ArrowRightLeft } from "lucide-react";
import type { Session } from "@/lib/db";
import { movableSession } from "@/lib/tasks/move-targets";
import { useMoveSession, useMoveTargets } from "@/data/tasks";

type MenuItem = ComponentType<{
  onSelect?: () => void;
  className?: string;
  children: ReactNode;
}>;

// "Move to <machine>" / "Move back to this machine" for any menu (the row's
// ⋯ and right-click menus, the pane's menu, the phone's session switcher);
// nothing when it can't move.
export function MoveMenuItems({
  session,
  Item,
  Before,
  After,
  iconClassName = "mr-2 h-3.5 w-3.5",
}: {
  session: Session;
  Item: MenuItem;
  // Separators around the items, only when there are items.
  Before?: ComponentType;
  After?: ComponentType;
  iconClassName?: string;
}) {
  const targets = useMoveTargets(movableSession(session));
  const move = useMoveSession();
  if (!targets.length) return null;
  return (
    <>
      {Before && <Before />}
      {targets.map((t) => (
        <Item
          key={t.hostId}
          // A 44px target on a phone.
          className="min-h-11 md:min-h-0"
          onSelect={() =>
            move(
              { id: session.id, name: session.name, hostId: session.host_id },
              t
            )
          }
        >
          <ArrowRightLeft className={iconClassName} />
          {t.label}
        </Item>
      ))}
      {After && <After />}
    </>
  );
}
