import type { Recommendation, Verdict } from "@/lib/analyst/types";

export type CardTone = "primary" | "green" | "amber" | "red" | "muted";

export interface CardView {
  label: string;
  tone: CardTone;
  // Send the prompt as written (or edited).
  canSend: boolean;
  // A blocked or needs-you card has no Send; the user can still write one.
  canWrite: boolean;
  canDismiss: boolean;
  canAskAgain: boolean;
  // Why to look twice before sending, or what happened to it.
  notes: string[];
}

const VERDICT_LABEL: Record<Verdict, [string, CardTone]> = {
  continue: ["Next prompt", "primary"],
  done: ["Looks done", "green"],
  blocked: ["Blocked", "red"],
  needs_you: ["Needs you", "amber"],
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * What a review card shows and offers. `rec` is the stored card for the
 * block, or null when there is none (an old review, an ended pairing): then
 * it's read-only.
 */
export function cardView(
  rec: Recommendation | null,
  verdict: Verdict | null,
  coderLastTurn: string | null
): CardView {
  const [vLabel, vTone] = verdict
    ? VERDICT_LABEL[verdict]
    : (["Review", "muted"] as const);
  const view: CardView = {
    label: vLabel,
    tone: vTone,
    canSend: false,
    canWrite: false,
    canDismiss: false,
    canAskAgain: false,
    notes: [],
  };
  if (!rec) return view;

  const s = rec.signals;
  if (s?.noToolTurns && s.noToolTurns === s.turns)
    view.notes.push(
      s.turns === 1
        ? "The coding agent's turn ended without a single tool call"
        : `None of the ${plural(s.turns, "turn")} made a tool call`
    );
  if (s?.interrupted) view.notes.push("The coding agent was interrupted");

  switch (rec.state) {
    case "sent":
      return {
        ...view,
        label: rec.edited ? "Sent, edited" : "Sent",
        tone: "muted",
        notes: [],
      };
    case "dismissed":
      return { ...view, label: "Dismissed", tone: "muted", notes: [] };
    case "superseded":
      return { ...view, label: "Superseded", tone: "muted", notes: [] };
    case "invalid":
      return {
        ...view,
        label: "Couldn't read",
        tone: "red",
        canAskAgain: true,
        canDismiss: true,
        notes: [rec.error || "The review block was invalid"],
      };
  }

  // Open.
  if (rec.coderThrough && coderLastTurn && rec.coderThrough !== coderLastTurn)
    view.notes.push("The coding agent has moved on since this review");
  if (s?.readWeb)
    view.notes.push("It read web content: check the prompt before sending");
  const sendable = verdict === "continue" || verdict === "done";
  return {
    ...view,
    canSend: sendable && !!rec.prompt,
    canWrite: true,
    canDismiss: true,
  };
}
