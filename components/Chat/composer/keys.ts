import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { enterAction, FENCE_LINE } from "@/lib/chat/enter";

export type MenuKey = "up" | "down" | "pick" | "close";

export interface KeyHandlers {
  plain: boolean;
  menuOpen: boolean;
  menuHasMatches: boolean;
  onMenuKey: (key: MenuKey) => void;
  onSend: () => void;
  onTogglePlain: () => void;
  // Cmd/Ctrl+Shift+V: the paste that follows goes in as plain text.
  onPasteAsText: () => void;
}

// Enter on a keyboard sends; on touch screens it's a newline and the button sends.
const coarsePointer = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(pointer: coarse)").matches;

// What Enter does when it isn't sending: a new list item, a new line in
// code, otherwise a new paragraph. Never a hard break, so a newline is "\n".
function newline(editor: Editor): boolean {
  const { taskItem } = editor.schema.nodes;
  return editor.commands.first(({ commands }) => [
    () => leaveCode(commands),
    () => commands.newlineInCode(),
    () => (taskItem ? commands.splitListItem("taskItem") : false),
    () =>
      editor.schema.nodes.listItem ? commands.splitListItem("listItem") : false,
    () => commands.createParagraphNear(),
    () => commands.liftEmptyBlock(),
    () => commands.splitBlock(),
  ]);
}

// A third newline at the end of a code block leaves it, as Enter does in
// TipTap's own code block; here Enter sends, so Shift+Enter does it.
function leaveCode(commands: Editor["commands"]): boolean {
  return commands.command(({ tr, state }) => {
    const { $from, empty } = tr.selection;
    const atEnd = $from.parentOffset === $from.parent.content.size;
    if (!empty || !$from.parent.type.spec.code || !atEnd) return false;
    if (!$from.parent.textContent.endsWith("\n\n")) return false;
    tr.delete($from.pos - 2, $from.pos);
    const after = tr.mapping.map($from.after());
    tr.insert(after, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    return true;
  });
}

// "```ts" then Enter: the line becomes a ts code block.
function openFence(editor: Editor, language: string): boolean {
  const { $from } = editor.state.selection;
  return editor
    .chain()
    .deleteRange({ from: $from.start(), to: $from.end() })
    .setNode("codeBlock", { language: language || null })
    .run();
}

export function handleKeyDown(
  editor: Editor,
  event: KeyboardEvent,
  h: KeyHandlers
): boolean {
  if (event.isComposing || event.keyCode === 229 || editor.view.composing)
    return false;
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.shiftKey && event.key.toLowerCase() === "v") {
    h.onPasteAsText();
    return false;
  }
  if (mod && event.key === "/") {
    h.onTogglePlain();
    return true;
  }
  const menu = h.menuOpen && h.menuHasMatches;
  if (menu && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    h.onMenuKey(event.key === "ArrowDown" ? "down" : "up");
    return true;
  }
  if (menu && event.key === "Tab") {
    h.onMenuKey("pick");
    return true;
  }
  if (h.menuOpen && event.key === "Escape") {
    h.onMenuKey("close");
    return true;
  }
  if (event.key !== "Enter") return false;

  const { $from } = editor.state.selection;
  const fence =
    h.plain || $from.parent.type.spec.code
      ? null
      : FENCE_LINE.exec($from.parent.textContent);
  const action = enterAction({
    shift: event.shiftKey,
    mod,
    composing: false,
    coarse: coarsePointer(),
    menuOpen: menu,
    fenceLine: Boolean(fence) && editor.can().setNode("codeBlock"),
  });
  if (action === "pick") h.onMenuKey("pick");
  else if (action === "send") h.onSend();
  else if (action === "fence") return openFence(editor, fence?.[2] ?? "");
  // A touch keyboard's plain Enter takes the default path; Shift+Enter
  // would otherwise be a hard break.
  else if (action === "newline")
    return event.shiftKey ? newline(editor) : false;
  return true;
}
