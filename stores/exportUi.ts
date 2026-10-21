import { proxy } from "valtio";
import {
  DEFAULT_REQUEST,
  type ExportRequest,
  type ExportTurnInfo,
} from "@/lib/export/view";

// The export sheet, and picking turns in the chat for it. The request lives
// here so it survives closing the sheet to select turns.
export const exportUi = proxy<{
  open: boolean;
  sessionId: string | null;
  title: string;
  req: ExportRequest;
  /** Open at the turn that began with this message, to the end. */
  fromItemId: string | null;
  /** The session's turns, as the last estimate listed them. */
  turns: ExportTurnInfo[];
  selecting: boolean;
  pick: { from: number | null; to: number | null };
}>({
  open: false,
  sessionId: null,
  title: "",
  req: { ...DEFAULT_REQUEST },
  fromItemId: null,
  turns: [],
  selecting: false,
  pick: { from: null, to: null },
});

export const exportUiActions = {
  open(sessionId: string, title: string, fromItemId: string | null = null) {
    if (exportUi.sessionId !== sessionId) {
      exportUi.turns = [];
      exportUi.req = { ...exportUi.req, range: undefined };
    }
    exportUi.sessionId = sessionId;
    exportUi.title = title;
    exportUi.fromItemId = fromItemId;
    exportUi.open = true;
  },
  close() {
    exportUi.open = false;
    exportUi.selecting = false;
    exportUi.fromItemId = null;
  },
  setRequest(patch: Partial<ExportRequest>) {
    exportUi.req = { ...exportUi.req, ...patch };
  },
  /** Close the sheet and let the chat's user messages be ticked. */
  startSelect(from: number | null = null) {
    exportUi.open = false;
    exportUi.selecting = true;
    exportUi.pick = { from, to: null };
  },
  /** A tap on a turn: the first sets the start, the second the end. */
  tap(n: number) {
    const { from, to } = exportUi.pick;
    exportUi.pick =
      from === null || to !== null ? { from: n, to: null } : { from, to: n };
  },
  /** Use the ticked turns as the range and go back to the sheet. */
  finishSelect() {
    const { from, to } = exportUi.pick;
    if (from !== null) {
      const end = to ?? from;
      exportUi.req = {
        ...exportUi.req,
        range: { from: Math.min(from, end), to: Math.max(from, end) },
      };
    }
    exportUi.selecting = false;
    exportUi.open = true;
  },
  cancelSelect() {
    exportUi.selecting = false;
    exportUi.open = true;
  },
};

/** The ticked turns, ordered: null until something is ticked. */
export function pickedRange(pick: { from: number | null; to: number | null }) {
  if (pick.from === null) return null;
  const end = pick.to ?? pick.from;
  return { from: Math.min(pick.from, end), to: Math.max(pick.from, end) };
}
