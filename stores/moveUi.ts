import { proxy } from "valtio";

// The move under way (or just finished), shown by MoveDialog wherever it was
// started from: the row menu, the pane menu, the palette or the Tasks panel.
export interface MoveJob {
  sessionId: string;
  name: string;
  // Where it runs now, and where it's going (names, for the copy).
  from: string;
  to: string;
  toHostId: string;
  // moving: the request is open. lost: the request dropped (the page
  // reloaded its connection, a proxy timed out) but the move may go on, so
  // the dialog follows the server's progress instead.
  phase: "moving" | "lost" | "done" | "failed";
  error: string | null;
  // The task's id where it runs now, once it has moved.
  arrivedId: string | null;
}

export const moveUi = proxy<{ job: MoveJob | null; open: boolean }>({
  job: null,
  open: false,
});

export const moveUiActions = {
  start: (job: Omit<MoveJob, "phase" | "error" | "arrivedId">): boolean => {
    if (moveUi.job?.phase === "moving" || moveUi.job?.phase === "lost") {
      moveUi.open = true;
      return false;
    }
    moveUi.job = { ...job, phase: "moving", error: null, arrivedId: null };
    moveUi.open = true;
    return true;
  },
  settle: (
    sessionId: string,
    result: Pick<MoveJob, "phase" | "error" | "arrivedId">
  ) => {
    if (moveUi.job?.sessionId !== sessionId) return;
    Object.assign(moveUi.job, result);
  },
  setOpen: (open: boolean) => {
    moveUi.open = open;
    // A finished move is forgotten once its dialog closes.
    if (
      !open &&
      (moveUi.job?.phase === "done" || moveUi.job?.phase === "failed")
    )
      moveUi.job = null;
  },
};
