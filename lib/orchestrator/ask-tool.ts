import { AskRefused, raiseAsk, type AskKind } from "./asks";
import { titleSubject } from "./ask-text";
import { addNote } from "./notes";

// `ask_saad`: parks the item and returns at once. The same title again,
// while it's open, refreshes that ask rather than adding a second.
export function askSaad(
  workspaceId: string,
  a: { title: string; detail: string; link?: string; kind: AskKind }
): string {
  let raised;
  try {
    raised = raiseAsk({
      workspaceId,
      subject: titleSubject(a.title),
      kind: a.kind,
      title: a.title,
      detail: a.detail,
      link: a.link ?? null,
    });
  } catch (error) {
    if (error instanceof AskRefused) return `Not asked: ${error.message}.`;
    throw error;
  }
  const { ask, created } = raised;
  if (!created)
    return `Already on Saad's list as ask ${ask.id}; updated it. Carry on with everything else.`;
  addNote(workspaceId, `Asked Saad: ${ask.title}`, "ask");
  return `Asked Saad (ask ${ask.id}). Carry on with everything else; his answer reaches you as an event.`;
}
