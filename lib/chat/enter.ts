export type EnterAction = "ignore" | "pick" | "fence" | "send" | "newline";

export interface EnterState {
  shift: boolean;
  // Mid IME composition: Enter confirms the candidate, nothing else.
  composing: boolean;
  // Touch screens: Enter is a newline and the button sends.
  coarse: boolean;
  menuOpen: boolean;
  // The line is "```lang": Enter opens a code block.
  fenceLine: boolean;
}

export function enterAction(s: EnterState): EnterAction {
  if (s.composing) return "ignore";
  if (s.menuOpen && !s.shift) return "pick";
  if (s.fenceLine) return "fence";
  if (s.shift || s.coarse) return "newline";
  return "send";
}

export const FENCE_LINE = /^(`{3,}|~{3,})([\w+#.-]*)$/;
