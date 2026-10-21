// Drag a session onto a group to file it there, or onto the list outside any
// group to take it out. Pure, so the rules are testable without a DOM.

export type DraggedSession = {
  id: string;
  groupId: string | null;
  // The session's workspace, by the same rule the server files by.
  workspaceId: string | null;
};

export type DropTarget = { groupId: string; workspaceId: string | null };

// What a drop should do: the group to file into (null = out of any group), or
// null when nothing should happen. A group of another workspace never takes
// the session (the server refuses it too); dropping on its own group, or an
// ungrouped session outside any group, changes nothing.
export function dropOutcome(
  dragged: DraggedSession,
  target: DropTarget | null
): { groupId: string | null } | null {
  if (!target) return dragged.groupId ? { groupId: null } : null;
  if ((target.workspaceId ?? null) !== (dragged.workspaceId ?? null))
    return null;
  return target.groupId === dragged.groupId
    ? null
    : { groupId: target.groupId };
}

export const DRAG_TYPE = "application/x-agentos-session";

// dragover can't read the payload, so the one drag in flight is kept here.
let current: DraggedSession | null = null;
export const dragging = () => current;
export const setDragging = (d: DraggedSession | null) => {
  current = d;
};
