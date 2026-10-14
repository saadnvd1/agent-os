// A fork continues its parent's conversation: it has a parent but wasn't
// started by anyone and isn't a task. A task or session started from another
// session also records that parent, and is not a fork.
export const isFork = (s: {
  parent_session_id?: string | null;
  started_by?: string | null;
  started_via?: string | null;
  task_prompt?: string | null;
}): boolean =>
  !!s.parent_session_id && !s.started_by && !s.started_via && !s.task_prompt;
