import type { Session } from "@/lib/db/types";

// Whether a session is a task (it has a prompt). A list carries has_prompt
// in place of the prompt's text; a single session carries the text.
export const hasPrompt = (
  s: Pick<Session, "task_prompt" | "has_prompt">
): boolean => !!(s.has_prompt ?? s.task_prompt);
