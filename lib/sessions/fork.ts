// A fork continues its parent's conversation: it has a parent but wasn't
// started by anyone and isn't a task. A task or session started from another
// session also records that parent, and is not a fork. A fork is stored with
// started_via "session" and no started_by, so that alone doesn't rule it out.
export const isFork = (s: {
  parent_session_id?: string | null;
  started_by?: string | null;
  started_via?: string | null;
  task_prompt?: string | null;
}): boolean =>
  !!s.parent_session_id &&
  !s.started_by &&
  (!s.started_via || s.started_via === "session") &&
  !s.task_prompt;
