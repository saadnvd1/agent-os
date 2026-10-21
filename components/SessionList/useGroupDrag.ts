import { useEffect, useRef, useState, type DragEvent } from "react";
import { useAssignGroup } from "@/data/session-groups";
import {
  DRAG_TYPE,
  dragging,
  dropOutcome,
  setDragging,
  type DraggedSession,
  type DropTarget,
} from "@/lib/sidebar/groupDrop";

// A session row you can pick up. Whole-row drag; the row's own click and
// menus are untouched, and touch keeps using Move to group.
export function useRowDrag(dragged: DraggedSession, enabled: boolean) {
  return {
    draggable: enabled,
    onDragStart: (e: DragEvent) => {
      setDragging(dragged);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(DRAG_TYPE, dragged.id);
    },
    onDragEnd: () => setDragging(null),
  };
}

const EXPAND_AFTER_MS = 600;

// Where a dragged session can land. A group passes itself as the target; the
// list around the groups passes null, which takes the session out of its group.
export function useDropZone(
  target: DropTarget | null,
  // A folded group opens when a valid drag rests on it.
  onRest?: () => void
) {
  const assign = useAssignGroup();
  const [over, setOver] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stopRest = () => clearTimeout(timer.current);
  useEffect(() => stopRest, []);

  const outcome = () => {
    const d = dragging();
    return d ? { d, out: dropOutcome(d, target) } : null;
  };
  const leave = () => {
    stopRest();
    setOver(false);
  };

  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        const o = outcome();
        if (!o?.out) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (target) {
          setOver(true);
          if (onRest && !timer.current)
            timer.current = setTimeout(onRest, EXPAND_AFTER_MS);
        }
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          leave();
          timer.current = undefined;
        }
      },
      onDrop: (e: DragEvent) => {
        const o = outcome();
        leave();
        timer.current = undefined;
        if (!o?.out) return;
        e.preventDefault();
        e.stopPropagation();
        setDragging(null);
        assign.mutate({ ids: [o.d.id], groupId: o.out.groupId });
      },
    },
  };
}
